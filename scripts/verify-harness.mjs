import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const npmRoot = execFileSync(
  process.platform === "win32" ? "cmd" : "npm",
  process.platform === "win32" ? ["/d", "/s", "/c", "npm", "root", "-g"] : ["root", "-g"],
  { encoding: "utf-8", windowsHide: true },
).trim();
const loaderPath = path.join(
  npmRoot,
  "@earendil-works",
  "pi-coding-agent",
  "dist",
  "core",
  "extensions",
  "loader.js",
);

assert.ok(fs.existsSync(loaderPath), `pi extension loader missing: ${loaderPath}`);

process.env.NEURA = "1";

const { loadExtensions } = await import(pathToFileURL(loaderPath).href);
const extensionDir = path.join(repoRoot, "agent", "extensions");
const files = fs.readdirSync(extensionDir)
  .filter((name) => name.endsWith(".ts"))
  .map((name) => path.join(extensionDir, name));
const loaded = await loadExtensions(files, repoRoot);

assert.deepEqual(loaded.errors, [], `extension load errors: ${JSON.stringify(loaded.errors)}`);
assert.equal(loaded.extensions.length, files.length, "not every extension loaded");

const extensionWithCommand = (name) => {
  const extension = loaded.extensions.find((candidate) => candidate.commands.has(name));
  assert.ok(extension, `/${name} command missing`);
  return extension;
};
const firstHandler = (extension, event) => {
  const handler = extension.handlers.get(event)?.[0];
  assert.equal(typeof handler, "function", `${event} handler missing`);
  return handler;
};
const stripAnsi = (value) => value.replace(/\x1b\[[0-9;]*m/g, "");
const widthOf = (value) => Array.from(stripAnsi(value)).length;

const widgets = new Map();
const statuses = new Map();
const notices = [];
const ui = {
  getTheme: () => null,
  setTheme() {},
  notify(message, level) {
    notices.push({ message, level });
  },
  setWidget(id, value) {
    if (value === undefined) widgets.delete(id);
    else widgets.set(id, value);
  },
  setStatus(id, value) {
    if (value === undefined) statuses.delete(id);
    else statuses.set(id, value);
  },
};
const context = { cwd: repoRoot, hasUI: true, ui };

const continuityExtension = extensionWithCommand("dash");
await firstHandler(continuityExtension, "session_start")({}, context);
assert.ok(widgets.has("neura-launch"), "continuity launch widget missing");
assert.equal(widgets.has("neura-logo"), false, "legacy logo widget still registered");
assert.equal(widgets.has("neura-dash"), false, "legacy dashboard widget still registered");

const launchFactory = widgets.get("neura-launch");
for (const width of [40, 60, 92, 120]) {
  const launchText = launchFactory(null, null).render(width).map(stripAnsi).join("\n");
  assert.match(launchText, /LAST/, `launch LAST state missing at ${width} columns`);
  assert.match(launchText, /NOW/, `launch NOW state missing at ${width} columns`);
  assert.match(launchText, /NEXT/, `launch NEXT state missing at ${width} columns`);
  assert.doesNotMatch(launchText, /\bToday\b|\bProjects\b|\bThis week\b/, "legacy dashboard content remains");
}
await firstHandler(continuityExtension, "agent_start")({}, context);
assert.equal(widgets.has("neura-launch"), false, "continuity launch did not hide when work started");
await continuityExtension.commands.get("dash").handler("", context);
assert.ok(widgets.has("neura-launch"), "/dash did not restore the continuity launch");

const theme = JSON.parse(fs.readFileSync(path.join(repoRoot, "agent", "themes", "neura-dark.json"), "utf-8"));
assert.equal(theme.colors.accent, "#d97841", "Forged Tungsten copper accent missing");
assert.equal(theme.colors.selectedBg, "#1c2024", "Forged Tungsten raised surface missing");
assert.equal(theme.colors.mdHeading, theme.colors.accent, "theme introduces a second heading accent");

const healthExtension = extensionWithCommand("health");
await healthExtension.commands.get("health").handler("", context);
assert.equal(statuses.size, 0, "health status not cleared");

for (const width of [40, 60, 92, 120]) {
  for (const [id, factory] of widgets) {
    const lines = factory(null, null).render(width);
    assert.ok(lines.length <= 10, `${id} exceeds pi 10-line widget limit`);
    assert.ok(lines.every((line) => widthOf(line) <= width), `${id} overflows at ${width} columns`);
  }
}

let footerFactory;
const cockpitContext = {
  model: { id: "gpt-5.5-engineering-preview" },
  getContextUsage: () => ({ percent: 71 }),
  sessionManager: { getBranch: () => [{ message: { usage: { cost: 3.14 } } }] },
  ui: { setFooter: (value) => { footerFactory = value; } },
};
const cockpit = loaded.extensions.find((extension) => extension.resolvedPath.endsWith(`${path.sep}cockpit.ts`));
assert.ok(cockpit, "cockpit extension missing");
await firstHandler(cockpit, "session_start")({}, cockpitContext);
const footer = footerFactory(
  { requestRender() {} },
  null,
  {
    getGitBranch: () => "feature/agentic-console-with-long-name",
    getExtensionStatuses: () => new Map([["proof", "proof full"]]),
    onBranchChange: () => () => {},
  },
);
for (const width of [24, 40, 80, 120]) {
  assert.ok(footer.render(width).every((line) => widthOf(line) <= width), `footer overflows at ${width} columns`);
}

// /preset must resolve dated catalog ids (claude-opus-5-2026xxxx) by prefix, newest first,
// and tell the user which provider to /login when the model is absent.
const presetExtension = extensionWithCommand("preset");
const runPreset = (name, models) => {
  notices.length = 0;
  return presetExtension.commands.get("preset").handler(name, {
    ui,
    modelRegistry: {
      find: (provider, id) => models.find((m) => m.provider === provider && m.id === id),
      getAll: () => models,
    },
  });
};
const opusCatalog = [
  { provider: "anthropic", id: "claude-opus-5-20260101" },
  { provider: "anthropic", id: "claude-opus-5-20260420" },
  { provider: "anthropic", id: "claude-sonnet-5" },
];
await runPreset("opus", opusCatalog);
assert.match(notices.at(-1).message, /claude-opus-5-20260420/, "/preset opus picked the wrong catalog entry");
await runPreset("opus", []);
assert.equal(notices.at(-1).level, "error", "/preset with no matching model should report an error");
assert.match(notices.at(-1).message, /\/login anthropic/, "/preset should point at the provider login");
await runPreset("", opusCatalog);
assert.match(notices.at(-1).message, /gpt.*opus.*qwen/s, "/preset listing lost a preset");

const guardrail = loaded.extensions.find((extension) => extension.resolvedPath.endsWith(`${path.sep}guardrail.ts`));
assert.ok(guardrail, "guardrail extension missing");
const guard = firstHandler(guardrail, "tool_call");
const headless = { hasUI: false, ui: { confirm: async () => true } };
const approved = { hasUI: true, ui: { confirm: async () => true } };
assert.equal(await guard({ toolName: "bash", input: { command: "git status" } }, headless), undefined);
assert.equal(
  (await guard({ toolName: "bash", input: { command: "git reset --hard HEAD" } }, headless))?.block,
  true,
);
assert.equal(
  (await guard({ toolName: "edit", input: { path: "C:/project/.env.local" } }, headless))?.block,
  true,
);
assert.equal(await guard({ toolName: "bash", input: { command: "terraform destroy" } }, approved), undefined);

console.log(
  `Neura verify: ${loaded.extensions.length} extensions; responsive UI, health, footer, presets, guardrails passed.`,
);

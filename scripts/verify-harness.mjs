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
delete process.env.NEURA_GCAL_ICS;

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
const ui = {
  getTheme: () => null,
  setTheme() {},
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

const dashboardExtension = extensionWithCommand("dash");
await firstHandler(dashboardExtension, "session_start")({}, context);

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
  `Neura verify: ${loaded.extensions.length} extensions; responsive UI, health, footer, guardrails passed.`,
);

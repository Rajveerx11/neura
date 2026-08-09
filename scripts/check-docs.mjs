import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  ".gitattributes",
  "AGENTS.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "DESIGN.md",
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "VERSION",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/workflows/verify.yml",
  "docs/ARCHITECTURE.md",
  "docs/CHANGELOG.md",
  "docs/DEVELOPMENT.md",
  "docs/DEPENDENCIES.md",
  "docs/RELEASING.md",
  "docs/STATUS.md",
  "plans/README.md",
];

for (const relative of required) {
  assert.ok(fs.existsSync(path.join(repoRoot, relative)), `required release file missing: ${relative}`);
}

const version = fs.readFileSync(path.join(repoRoot, "VERSION"), "utf-8").trim();
assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, `invalid VERSION: ${version}`);
const releasePath = path.join(repoRoot, "docs", "releases", `v${version}.md`);
assert.ok(fs.existsSync(releasePath), `release notes missing: docs/releases/v${version}.md`);

for (const relative of ["README.md", "docs/CHANGELOG.md", `docs/releases/v${version}.md`]) {
  const text = fs.readFileSync(path.join(repoRoot, relative), "utf-8");
  assert.ok(text.includes(version), `${relative} does not reference VERSION ${version}`);
}

const ignoredDirectories = new Set([".git", ".agents", ".pi-subagents", ".proofofwork", ".pytest_cache", ".ruff_cache", ".tmp-hermes-agent", "node_modules"]);
const markdownFiles = [];
const visit = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(absolute);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) markdownFiles.push(absolute);
  }
};
visit(repoRoot);

const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
for (const file of markdownFiles) {
  const text = fs.readFileSync(file, "utf-8");
  for (const match of text.matchAll(linkPattern)) {
    let target = match[1].trim().replace(/^<|>$/g, "").split("#", 1)[0];
    if (!target || /^(?:https?:|mailto:)/i.test(target)) continue;
    target = decodeURIComponent(target);
    const resolved = path.resolve(path.dirname(file), target);
    assert.ok(fs.existsSync(resolved), `${path.relative(repoRoot, file)} has broken link: ${match[1]}`);
  }
}

const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf-8");
assert.doesNotMatch(readme, /continuity launch|LAST\/NOW\/NEXT/i, "README contains superseded continuity-launch claims");
assert.match(readme, /logo-only launch/i, "README does not state current logo-only launch");
assert.match(fs.readFileSync(path.join(repoRoot, "plans", "README.md"), "utf-8"), /polish-neura-launch-screen-plan\.html[^\n]*Superseded/i, "launch-polish plan is not marked superseded");

for (const relative of ["agent/settings.json", "agent/mcp.json", "agent/keybindings.json", "package.json", "package-lock.json", "tsconfig.json"]) {
  JSON.parse(fs.readFileSync(path.join(repoRoot, relative), "utf-8"));
}

assert.equal(fs.existsSync(path.join(repoRoot, "requirements.compiled")), false, "unrelated ComfyUI requirements remain in repository root");
assert.equal(fs.existsSync(path.join(repoRoot, "override.txt")), false, "unrelated ComfyUI override remains in repository root");

const extensionCount = fs.readdirSync(path.join(repoRoot, "agent", "extensions")).filter((name) => name.endsWith(".ts")).length;
assert.equal(extensionCount, 16, `expected 16 extensions, found ${extensionCount}`);

console.log(`Neura docs: ${markdownFiles.length} Markdown files, required release files, links, version ${version}, and repository claims passed.`);

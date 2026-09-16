import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  ".gitattributes",
  ".gitleaksignore",
  "AGENTS.md",
  "CLAUDE.md",
  "agent/neura/launch-artwork.md",
  "agent/neura/launch-artwork.png",
  "assets/screenshots/README.md",
  "assets/screenshots/learn-workshop.png",
  "assets/screenshots/plan-review.png",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "DESIGN.md",
  "GOVERNANCE.md",
  "LICENSE",
  "NOTICE",
  "README.md",
  "SECURITY.md",
  "SUPPORT.md",
  "VERSION",
  ".github/CODEOWNERS",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/ISSUE_TEMPLATE/feature_request.yml",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/dependabot.yml",
  ".github/release.yml",
  ".github/workflows/codeql.yml",
  ".github/workflows/release.yml",
  ".github/workflows/verify.yml",
  "docs/ARCHITECTURE.md",
  "docs/CHANGELOG.md",
  "docs/DEVELOPMENT.md",
  "docs/DEPENDENCIES.md",
  "docs/LEARN_DEPENDENCIES.md",
  "docs/LEARN_MODE.md",
  "docs/OPEN_SOURCE.md",
  "docs/README.md",
  "docs/RELEASING.md",
  "docs/STATUS.md",
  "docs/VERIFICATION.md",
  "plans/README.md",
];

for (const relative of required) {
  assert.ok(fs.existsSync(path.join(repoRoot, relative)), `required release file missing: ${relative}`);
}

const version = fs.readFileSync(path.join(repoRoot, "VERSION"), "utf-8").trim();
assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, `invalid VERSION: ${version}`);
const rootPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf-8"));
const rootLock = JSON.parse(fs.readFileSync(path.join(repoRoot, "package-lock.json"), "utf-8"));
const nestedPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, "agent", "neura", "package.json"), "utf-8"));
const nestedLock = JSON.parse(fs.readFileSync(path.join(repoRoot, "agent", "neura", "package-lock.json"), "utf-8"));
assert.equal(rootPackage.version, version, "package.json version does not match VERSION");
assert.equal(rootLock.version, version, "package-lock.json version does not match VERSION");
assert.equal(rootLock.packages?.[""]?.version, version, "root lock package version does not match VERSION");
assert.equal(nestedLock.version, nestedPackage.version, "nested package and lock versions differ");
assert.equal(nestedLock.packages?.[""]?.version, nestedPackage.version, "nested lock root version differs");
const releasePath = path.join(repoRoot, "docs", "releases", `v${version}.md`);
assert.ok(fs.existsSync(releasePath), `release notes missing: docs/releases/v${version}.md`);

for (const relative of ["README.md", "docs/CHANGELOG.md", `docs/releases/v${version}.md`]) {
  const text = fs.readFileSync(path.join(repoRoot, relative), "utf-8");
  assert.ok(text.includes(version), `${relative} does not reference VERSION ${version}`);
}

const ignoredDirectories = new Set([".git", ".agents", ".pi-subagents", ".proofofwork", ".pytest_cache", ".ruff_cache", ".tmp-hermes-agent", ".worktrees", "node_modules"]);
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
assert.match(readme, /image-backed centred launch/i, "README does not state current image-backed launch");
assert.match(readme, /logo-only fallback/i, "README does not state the launch fallback");
assert.match(readme, /not production-ready/i, "README does not state current production limit");
assert.match(readme, /Apache License 2\.0/i, "README does not state Apache-2.0 license");
assert.doesNotMatch(readme, /private engineering-agent harness/i, "README contains stale private-project positioning");
assert.match(fs.readFileSync(path.join(repoRoot, "plans", "README.md"), "utf-8"), /polish-neura-launch-screen-plan\.html[^\n]*Superseded/i, "launch-polish plan is not marked superseded");

for (const relative of ["agent/settings.json", "agent/mcp.json", "agent/keybindings.json", "agent/neura/runtime-contract.json", "agent/neura/package.json", "agent/neura/package-lock.json", "package.json", "package-lock.json", "tsconfig.json"]) {
  JSON.parse(fs.readFileSync(path.join(repoRoot, relative), "utf-8"));
}

const packageMetadata = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf-8"));
assert.equal(packageMetadata.license, "Apache-2.0", "package.json license is not Apache-2.0");
assert.equal(packageMetadata.private, true, "package.json must remain private");
assert.equal(nestedPackage.license, "Apache-2.0", "nested package license is not Apache-2.0");
assert.equal(nestedPackage.private, true, "nested package must remain private");
assert.equal(nestedPackage.repository?.url, packageMetadata.repository?.url, "nested package repository URL differs");
assert.equal(nestedPackage.repository?.directory, "agent/neura", "nested package repository directory is missing");
const license = fs.readFileSync(path.join(repoRoot, "LICENSE"), "utf-8");
assert.match(license, /Apache License\s+Version 2\.0, January 2004/, "LICENSE is not Apache-2.0");
assert.match(license, /END OF TERMS AND CONDITIONS/, "Apache-2.0 LICENSE is incomplete");

assert.equal(fs.existsSync(path.join(repoRoot, "requirements.compiled")), false, "unrelated ComfyUI requirements remain in repository root");
assert.equal(fs.existsSync(path.join(repoRoot, "override.txt")), false, "unrelated ComfyUI override remains in repository root");

const extensionCount = fs.readdirSync(path.join(repoRoot, "agent", "extensions")).filter((name) => name.endsWith(".ts")).length;
assert.equal(extensionCount, 18, `expected 18 extensions, found ${extensionCount}`);

console.log(`Neura docs: ${markdownFiles.length} Markdown files, required release files, links, version ${version}, and repository claims passed.`);

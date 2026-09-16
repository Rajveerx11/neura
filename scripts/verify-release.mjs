import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const NUMERIC_IDENTIFIER = "(?:0|[1-9]\\d*)";
const PRERELEASE_IDENTIFIER = "(?:0|[1-9]\\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)";
const VERSION_PATTERN = `${NUMERIC_IDENTIFIER}\\.${NUMERIC_IDENTIFIER}\\.${NUMERIC_IDENTIFIER}(?:-${PRERELEASE_IDENTIFIER}(?:\\.${PRERELEASE_IDENTIFIER})*)?`;
const SEMVER = new RegExp(`^${VERSION_PATTERN}$`);
const TAG_SEMVER = new RegExp(`^v${VERSION_PATTERN}$`);
const REQUIRED_PRERELEASE_TEXT = [
  /experimental and not production-ready/i,
  /Human Away remains preview-only and is not approved for unattended high-impact work/i,
  /No npm package is published by this release/i,
];

function read(root, relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function readJson(root, relative) {
  return JSON.parse(read(root, relative));
}

export function verifyRelease({ repoRoot, tag }) {
  assert.match(tag ?? "", TAG_SEMVER, "tag must be v-prefixed semantic version");
  const version = read(repoRoot, "VERSION").trim();
  assert.match(version, SEMVER, `invalid VERSION: ${version}`);
  assert.equal(tag, `v${version}`, `tag ${tag} does not match VERSION ${version}`);

  const rootPackage = readJson(repoRoot, "package.json");
  const rootLock = readJson(repoRoot, "package-lock.json");
  const nestedPackage = readJson(repoRoot, "agent/neura/package.json");
  const nestedLock = readJson(repoRoot, "agent/neura/package-lock.json");
  assert.equal(rootPackage.version, version, "package.json version does not match VERSION");
  assert.equal(rootLock.version, version, "package-lock.json version does not match VERSION");
  assert.equal(rootLock.packages?.[""]?.version, version, "root lock package version does not match VERSION");
  assert.equal(nestedLock.version, nestedPackage.version, "nested package and lock versions differ");
  assert.equal(nestedLock.packages?.[""]?.version, nestedPackage.version, "nested lock package version differs");
  assert.equal(rootPackage.private, true, "root package must remain private");
  assert.equal(nestedPackage.private, true, "nested package must remain private");

  const notesRelative = `docs/releases/v${version}.md`;
  const notes = read(repoRoot, notesRelative);
  assert.match(notes, new RegExp(`^# Neura v${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"), "release-note heading does not match VERSION");

  const prerelease = version.includes("-");
  const status = read(repoRoot, "docs/STATUS.md");
  if (!prerelease) {
    assert.match(status, /^Release channel:\s*stable-ready\s*$/im, "stable releases require the explicit STATUS marker: Release channel: stable-ready");
    assert.doesNotMatch(status, /not production-ready/i, "stable releases are blocked while STATUS says not production-ready");
  } else {
    assert.match(notes, /^Channel:\s*(?:draft\s+)?prerelease\s*$/im, "prerelease notes must declare the prerelease channel");
    for (const required of REQUIRED_PRERELEASE_TEXT) {
      assert.match(notes, required, `prerelease notes missing required safety text: ${required}`);
    }
  }

  return { version, prerelease, notesRelative };
}

function parseArgs(argv) {
  let tag = process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined;
  let repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--tag") tag = argv[++index];
    else if (argv[index] === "--repo") repoRoot = path.resolve(argv[++index]);
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  return { tag, repoRoot };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = verifyRelease(parseArgs(process.argv.slice(2)));
    console.log(`Release ${result.version}: version, private packages, notes, and ${result.prerelease ? "prerelease" : "stable"} policy passed.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

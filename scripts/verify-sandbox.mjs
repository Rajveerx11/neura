import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const { runInHumanAwaySandbox } = await import(
  pathToFileURL(path.join(repoRoot, "agent", "neura", "human-away-sandbox.ts")).href
);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "neura-sandbox-verify-"));

try {
  const result = await runInHumanAwaySandbox(scratch, [
    "set -eu",
    "test ! -e /mnt/c/Users",
    "test ! -e /home/rajveer",
    "test -z \"${COMPOSIO_API_KEY:-}\"",
    "! getent hosts example.com >/dev/null 2>&1",
    "! touch /etc/neura-sandbox-write >/dev/null 2>&1",
    "printf 'workspace-only\\n' > sandbox-output.txt",
    "printf 'Authorization: Bearer synthetic-sandbox-secret\\n'",
  ].join("; "));
  assert.equal(result.code, 0, `sandbox probe failed: ${result.stderr}`);
  assert.equal(fs.readFileSync(path.join(scratch, "sandbox-output.txt"), "utf-8"), "workspace-only\n");
  assert.doesNotMatch(result.stdout, /synthetic-sandbox-secret/, "sandbox output leaked a bearer token");
  assert.match(result.stdout, /\[REDACTED\]/, "sandbox output lost redaction marker");

  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "neura-sandbox-outside-"));
  fs.symlinkSync(outside, path.join(scratch, "junction-escape"), "junction");
  await assert.rejects(
    runInHumanAwaySandbox(scratch, "true"),
    /refused linked workspace entry/,
    "sandbox accepted a workspace junction escape",
  );
  fs.rmSync(outside, { recursive: true, force: true });

  console.log("Neura sandbox: workspace write allowed; Windows/WSL home, host env, network, system writes, and junction escapes blocked.");
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

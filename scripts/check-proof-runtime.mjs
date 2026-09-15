import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { inspectProofSandboxRuntime } from '../agent/neura/human-away-sandbox.ts';

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'neura-proof-runtime-'));
try {
  const status = await inspectProofSandboxRuntime(undefined, workspace);
  if (status.ready) console.log(status.detail);
  else {
    console.error(`${status.detail}; ${status.action}`);
    process.exitCode = 1;
  }
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}

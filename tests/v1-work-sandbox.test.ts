// Explicit configured-host acceptance. Missing Windows/WSL/bubblewrap is a failure, not a skip.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createWorkspaceTools } from '../src/work.ts';

test('configured-host Work acceptance: approved command succeeds only through the real sandbox', { timeout: 150000 }, async () => {
  assert.equal(process.platform, 'win32', 'Configured-host Work acceptance requires native Windows with WSL2/bubblewrap.');
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'neura-work-host-'));
  const oldHome = process.env.NEURA_HOME;
  try {
    const workspace = path.join(scratch, 'workspace'); await fs.mkdir(workspace);
    process.env.NEURA_HOME = path.join(scratch, 'private');
    let approvals = 0;
    const tools = createWorkspaceTools(workspace, () => 'work', () => 0, async description => {
      approvals++; assert.match(description, /network-disabled WSL sandbox/); return true;
    });
    const result = (await tools.find(tool => tool.name === 'work_exec')!.execute({ command: "printf 'approved\\n' > approved.txt" }, {})).content[0];
    assert.ok(result.type === 'text'); assert.equal(JSON.parse(result.text).code, 0);
    assert.equal(await fs.readFile(path.join(workspace, 'approved.txt'), 'utf8'), 'approved\n');
    assert.equal(approvals, 1);
  } finally {
    if (oldHome === undefined) delete process.env.NEURA_HOME; else process.env.NEURA_HOME = oldHome;
    await fs.rm(scratch, { recursive: true, force: true });
  }
});

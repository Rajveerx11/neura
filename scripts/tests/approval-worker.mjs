import fs from 'node:fs';
import path from 'node:path';
// Parent supplies a synthetic directory and sanitized environment; no real state.
const [directory, worker, mode = 'normal'] = process.argv.slice(2);
process.env.NEURA_APPROVAL_DIR = directory;
const store = await import('../../agent/neura/approval-store.ts');
const action = {
  workspace: path.join(directory,'workspace'), toolName:'edit', summary:'synthetic edit',
  category:'protected', risk:'high', actionFingerprint:worker,
  workspaceFingerprint:'synthetic-workspace', approvalBinding:{target:'synthetic'},
};
const verdict = {decision:'defer',reason:'synthetic test',saferPath:'review',reviewer:'policy'};
if (mode === 'partial' || mode === 'short') {
  const { syncBuiltinESMExports } = await import('node:module');
  const original = fs.writeSync;
  let calls=0;
  fs.writeSync = (fd, buffer, offset, length, ...rest) => {
    if (mode === 'partial' && calls++) throw new Error('synthetic interrupted write');
    return original(fd,buffer,offset,Math.min(length,7),...rest);
  };
  syncBuiltinESMExports();
}
if (mode === 'barrier') {
  fs.writeFileSync(path.join(directory, `ready-${worker}`), 'ready');
  const deadline=Date.now()+10000;
  while (!fs.existsSync(path.join(directory,'go'))) {
    if(Date.now()>deadline) throw new Error('worker barrier timed out');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5);
  }
}
try {
  for(let i=0;i<8;i++) store.recordDecision({...action,actionFingerprint:`${worker}-${i}`},verdict,'pending',true);
  if(mode==='partial') throw new Error('partial write unexpectedly succeeded');
} catch(error) {
  if(mode!=='partial' || !/synthetic interrupted write/.test(error.message)) throw error;
}

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { isolate } from './isolation.mjs';
const scratch = isolate();
const {bubblewrapArguments,bubblewrapInput,removeCreatedHostRunPaths,assertWorkspaceHasNoLinks,validateProofRuntimeInventory,validateProofRuntimeProbe} = await import('../../agent/neura/human-away-sandbox.ts');
const args=bubblewrapArguments('/workspace-fixture','printf synthetic');
for(const flag of ['--unshare-all','--clearenv','--die-with-parent','--new-session']) assert.ok(args.includes(flag));
assert.deepEqual(args.slice(-3),['sh','-lc','printf synthetic']);
assert.deepEqual(bubblewrapInput(args).toString('utf8').split('\0').slice(0,-1),args);
const manyMounts=Array.from({length:800},(_,i)=>`/workspace/path with spaces/package-${i}/.github`);
assert.ok(bubblewrapInput(manyMounts).length>32767);
assert.deepEqual(bubblewrapInput(manyMounts).toString('utf8').split('\0').slice(0,-1),manyMounts);
assert.throws(()=>bubblewrapInput(['safe','bad\0--bind']),/NUL/);
// Host Git runs what .git holds, so the read-only bind must land on top of the writable workspace bind.
assert.ok(args.indexOf('--ro-bind-try')>args.indexOf('--bind'),'.git must be bound read-only after the workspace');
assert.deepEqual(args.slice(args.indexOf('--ro-bind-try')+1,args.indexOf('--ro-bind-try')+3),['/workspace-fixture/.git','/workspace/.git']);
assert.equal(args.includes('/mnt/c'),false);
assert.equal(args.includes(process.env.USERPROFILE),false);
const trust={uvVersion:'0.12.11',uvSha256:'a'.repeat(64),uvxSha256:'b'.repeat(64),
  python:{path:'/usr/bin/python3.12',version:'3.12.3',package:'python3.12-minimal',packageVersion:'3.12.3-1ubuntu0.13',architecture:'amd64',sha256:'d'.repeat(64)},
  wheels:{'proof.whl':'c'.repeat(64)}};
const inventory=['/trusted/uv/uv','/trusted/uv/uvx',trust.python.path,'/trusted/wheels',trust.uvSha256,trust.uvxSha256,
  trust.python.sha256,`${trust.python.package}\t${trust.python.packageVersion}\t${trust.python.architecture}`,`proof.whl\t${'c'.repeat(64)}`,'1'].join('\n');
const runtime=validateProofRuntimeInventory(inventory,'/trusted/uv','/trusted/wheels',trust);
assert.ok(runtime,'valid proof runtime inventory rejected');
assert.equal(validateProofRuntimeInventory('', '/trusted/uv','/trusted/wheels',trust),null,'missing proof inventory accepted');
assert.equal(validateProofRuntimeInventory(inventory.replace('/usr/bin/python3.12','/tmp/python'),'/trusted/uv','/trusted/wheels',trust),null,'wrong Python path accepted');
assert.equal(validateProofRuntimeInventory(inventory.replace(trust.python.sha256,'e'.repeat(64)),'/trusted/uv','/trusted/wheels',trust),null,'tampered Python accepted');
assert.equal(validateProofRuntimeInventory(inventory.replace('3.12.3-1ubuntu0.13','3.12.3-1ubuntu0.12'),'/trusted/uv','/trusted/wheels',trust),null,'wrong Python package build accepted');
assert.equal(validateProofRuntimeInventory(inventory.replace('c'.repeat(64),'f'.repeat(64)),'/trusted/uv','/trusted/wheels',trust),null,'tampered proof wheel accepted');
const probe=`uvx ${trust.uvVersion}\n${trust.python.version}\nproof-ready`;
assert.equal(validateProofRuntimeProbe(probe,trust),true,'valid sandbox runtime probe rejected');
assert.equal(validateProofRuntimeProbe('',trust),false,'missing sandbox runtime probe accepted');
assert.equal(validateProofRuntimeProbe(probe.replace('3.12.3','3.12.4'),trust),false,'wrong Python version accepted');
assert.equal(validateProofRuntimeProbe(probe.replace('uvx 0.12.11','uvx 0.12.10'),trust),false,'wrong uvx version accepted');
const guardedCommand='printf "uvx\\npython\\nentrypoint\\nproof-ready\\n" > guarded-proof-marker';
const proofArgs=bubblewrapArguments('/workspace-fixture',guardedCommand,validateProofRuntimeInventory(inventory,'/trusted/uv','/trusted/wheels',trust));
assert.ok(proofArgs.includes('/tmp/proof-wheels') && proofArgs.includes('/tmp/neura-bin/uvx') && proofArgs.includes('/tmp/neura-bin/python3.12'),'proof dependencies were not mounted read-only');
const proofTail=proofArgs.slice(proofArgs.lastIndexOf('--'));
assert.deepEqual(proofTail.slice(0,3),['--','sh','-lc']);
assert.equal(proofTail[4],'neura-proof');
assert.equal(proofTail[5],guardedCommand,'guarded proof command was not passed as inert shell data');
assert.doesNotMatch(proofTail[3],/proof-ready|entrypoint/,'guarded proof command was interpolated into integrity wrapper');
assert.match(proofTail[3],/^set -eu;[^]*sha256sum -c -[^]*export UV_CACHE_DIR=\/tmp\/uv-cache; exec sh -lc "\$1"$/,'proof wrapper does not fail closed before isolated command execution');
const shell=process.platform==='win32'?'C:\\Program Files\\Git\\bin\\sh.exe':'/bin/sh';
const failed=spawnSync(shell,['-lc',proofTail[3],proofTail[4],proofTail[5]],{cwd:scratch,encoding:'utf8',windowsHide:true});
assert.notEqual(failed.status,0,'failed integrity check returned success');
assert.equal(fs.existsSync(path.join(scratch,'guarded-proof-marker')),false,'failed integrity check executed uvx, Python, or proof entrypoint');
assert.doesNotMatch(failed.stdout ?? '',/proof-ready/,'failed health integrity check printed proof-ready');
fs.mkdirSync(path.join(scratch,'inside'));
fs.mkdirSync(path.join(scratch,'outside'));
assert.doesNotThrow(()=>assertWorkspaceHasNoLinks(path.join(scratch,'inside')));
fs.symlinkSync(path.join(scratch,'outside'),path.join(scratch,'inside/link'),'junction');
assert.throws(()=>assertWorkspaceHasNoLinks(path.join(scratch,'inside')),/refused linked workspace entry/);
const project=path.join(scratch,'project');
for(const folder of ['.git/hooks','.github/workflows','.husky','src/.git','.aws','node_modules/.bin','node_modules/real'])fs.mkdirSync(path.join(project,folder),{recursive:true});
for(const file of ['.env','.github/.env','node_modules/real/.env','src/.env.local','src/app.ts','.env.example'])fs.writeFileSync(path.join(project,file),'x');
fs.symlinkSync(path.join(project,'node_modules/real'),path.join(project,'node_modules/.bin/tool'),'junction');
const scan=assertWorkspaceHasNoLinks(project);
assert.deepEqual([...scan.hostRun].sort(),['.git','.github','.husky','src/.git'],'installed links pass and host-run folders are found at any depth');
assert.deepEqual(scan.secrets.map(entry=>`${entry.path}:${entry.directory}`).sort(),['.aws:true','.env:false','.github/.env:false','node_modules/real/.env:false','src/.env.local:false']);
const guarded=bubblewrapArguments('/ws','true',undefined,scan).join(' ');
for(const bind of ['--ro-bind /ws/.github /workspace/.github','--ro-bind /ws/.husky /workspace/.husky','--ro-bind /ws/src/.git /workspace/src/.git','--ro-bind /dev/null /workspace/.env','--ro-bind /dev/null /workspace/src/.env.local','--tmpfs /workspace/.aws'])assert.ok(guarded.includes(bind),bind);
assert.ok(guarded.indexOf('--bind /ws /workspace')<guarded.indexOf('--ro-bind /ws/.github'),'protections mount over the writable workspace');
assert.doesNotMatch(guarded,/\.env\.example/);
const linkedDependencies=path.join(scratch,'linked-deps');
fs.mkdirSync(linkedDependencies);
fs.symlinkSync(path.join(scratch,'outside'),path.join(linkedDependencies,'node_modules'),'junction');
assert.throws(()=>assertWorkspaceHasNoLinks(linkedDependencies),/refused linked workspace entry/,'node_modules itself must be a real folder');
const linkedGit=path.join(scratch,'linked-git');
fs.mkdirSync(linkedGit);
fs.symlinkSync(path.join(scratch,'outside'),path.join(linkedGit,'.github'),'junction');
assert.throws(()=>assertWorkspaceHasNoLinks(linkedGit),/refused linked workspace entry/,'a linked bind source could mount outside the workspace');
for(const entry of ['.git','src/.git']) {
  const gitfileRoot=path.join(scratch,entry==='.git'?'root-gitfile':'nested-gitfile');
  fs.mkdirSync(path.dirname(path.join(gitfileRoot,entry)),{recursive:true});
  fs.writeFileSync(path.join(gitfileRoot,entry),'gitdir: git-storage\n');
  assert.throws(()=>assertWorkspaceHasNoLinks(gitfileRoot),/do not support \.git files/,'a gitfile must never leave its target writable');
}
const hardlinked=path.join(scratch,'hardlinked');
fs.mkdirSync(hardlinked);
fs.writeFileSync(path.join(hardlinked,'ordinary'),'fixture');
fs.linkSync(path.join(hardlinked,'ordinary'),path.join(hardlinked,'alias'));
assert.throws(()=>assertWorkspaceHasNoLinks(hardlinked),/refused hardlinked workspace entry/);
const cleanupRoot=path.join(scratch,'cleanup');
fs.mkdirSync(path.join(cleanupRoot,'.git'),{recursive:true});
fs.mkdirSync(path.join(cleanupRoot,'.aws','.git'),{recursive:true});
const beforeCleanup=assertWorkspaceHasNoLinks(cleanupRoot);
fs.mkdirSync(path.join(cleanupRoot,'.husky'));
fs.mkdirSync(path.join(cleanupRoot,'blocked'));
fs.mkdirSync(path.join(cleanupRoot,'later','.vscode'),{recursive:true});
fs.mkdirSync(path.join(cleanupRoot,'.azure','.git'),{recursive:true});
const originalRead=fs.readdirSync,originalStat=fs.lstatSync;
try {
  fs.readdirSync=function(directory,...rest) {
    if(directory===path.join(cleanupRoot,'blocked'))throw new Error('synthetic unreadable directory');
    return originalRead.call(this,directory,...rest);
  };
  syncBuiltinESMExports();
  const cleaned=removeCreatedHostRunPaths(cleanupRoot,beforeCleanup);
  assert.deepEqual(cleaned.created.sort(),['.azure/.git','.husky','later/.vscode']);
  assert.deepEqual(cleaned.errors,['blocked']);
  assert.ok(fs.existsSync(path.join(cleanupRoot,'.git')),'pre-existing controls must survive');
  assert.ok(fs.existsSync(path.join(cleanupRoot,'.aws','.git')),'pre-existing masked subtrees must not be cleaned');
  fs.mkdirSync(path.join(cleanupRoot,'.husky'));
  fs.readdirSync=function(directory,...rest) {
    if(directory===cleanupRoot)return [...Array.from({length:200001},(_,i)=>({name:`ordinary-${i}`})),{name:'.husky'}];
    return originalRead.call(this,directory,...rest);
  };
  fs.lstatSync=function(file,...rest) {
    if(path.dirname(file)===cleanupRoot && path.basename(file).startsWith('ordinary-'))return {isSymbolicLink:()=>false,isDirectory:()=>false,isFile:()=>true,nlink:1};
    return originalStat.call(this,file,...rest);
  };
  syncBuiltinESMExports();
  assert.throws(()=>assertWorkspaceHasNoLinks(cleanupRoot),/safe entry limit/);
  assert.deepEqual(removeCreatedHostRunPaths(cleanupRoot,beforeCleanup),{created:['.husky'],errors:[]},'discovery overflow must not prevent cleanup');
  assert.equal(fs.existsSync(path.join(cleanupRoot,'.husky')),false);
} finally {
  fs.readdirSync=originalRead;fs.lstatSync=originalStat;syncBuiltinESMExports();
}
console.log('PASS sandbox contract; live WSL replay: npm run verify:sandbox');

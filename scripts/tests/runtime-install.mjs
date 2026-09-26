import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'neura-install-test-'));
const home = path.join(tmp, 'home');
const source = path.join(tmp, 'source');
const helper = path.join(source, 'agent/neura/runtime-install.mjs');
const live = name => name.startsWith('launcher/') ? path.join(home, '.local/bin/neura.cmd') : path.join(home, '.pi/agent', name.slice(6));
const stage = path.join(home, '.pi/neura-install-pending/stage');
const write = (file, data) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, data); };
const run = (mode, ok = true, env = {}) => {
  const result = spawnSync(process.execPath, [helper, mode], { encoding: 'utf8', env: {...process.env, HOME: home, USERPROFILE: home, PI_CODING_AGENT_DIR: path.join(home, '.pi/agent'), ...env} });
  assert.equal(result.status === 0, ok, `${mode}: ${result.stderr}`);
  return result;
};
const build = (extension = 'one.ts') => {
  write(path.join(source, 'agent/extensions', extension), extension);
  write(path.join(source, 'agent/neura/runtime-install.mjs'), fs.readFileSync(new URL('../..//agent/neura/runtime-install.mjs', import.meta.url)));
  write(path.join(source, 'agent/mcp.json'), '{}');
  write(path.join(source, 'launcher/neura.cmd'), '@echo off');
  const names = [`agent/extensions/${extension}`, 'agent/neura/runtime-install.mjs', 'agent/mcp.json', 'launcher/neura.cmd'];
  const files = Object.fromEntries(names.map(name => [name, sha(path.join(source, name))]));
  write(path.join(source, 'agent/neura/release-manifest.json'), JSON.stringify({schemaVersion:1, neuraVersion:'2.5.1', piVersion:'0.87.1',nodeMinimum:'24.15.0',automaticExecutables:{git:{}}, runtimePackages:[],capabilities:{work:'default'},files}));
};
const seal = () => { run('prepare'); write(path.join(stage, 'agent/neura/.learn-runtime-lock'), 'receipt'); write(path.join(stage, 'agent/neura/node_modules/example.js'), 'pinned'); run('seal'); };
try {
  build();
  write(path.join(source, 'agent/extensions/one.ts'), 'changed source');
  run('prepare', false); // source bytes must match the release manifest
  write(path.join(source, 'agent/extensions/one.ts'), 'one.ts');
  assert.match(run('prepare', false, {NEURA_INSTALL_TEST_FAIL_PREPARE_AFTER:'1'}).stderr, /injected staging failure/);
  assert.equal(fs.existsSync(path.join(home, '.pi/neura-install-pending')), false, 'failed preparation left a shared transaction behind');
  const legacyModule = live('agent/neura/node_modules/user-package.js');
  write(legacyModule, 'unreceipted');
  assert.match(run('prepare', false).stderr, /unreceipted Learn runtime/);
  assert.equal(fs.readFileSync(legacyModule, 'utf8'), 'unreceipted');
  fs.rmSync(path.dirname(legacyModule), {recursive:true, force:true});
  write(live('agent/settings.json'), '{"credential":"synthetic-only"}');
  seal(); run('activate'); run('check');
  const alternateAgent = path.join(tmp, 'alternate-agent');
  fs.cpSync(path.join(home, '.pi/agent'), alternateAgent, {recursive: true});
  run('check', true, {PI_CODING_AGENT_DIR: alternateAgent});
  write(path.join(alternateAgent, 'extensions/one.ts'), 'tampered');
  run('check', false, {PI_CODING_AGENT_DIR: alternateAgent});
  assert.equal(fs.readFileSync(live('agent/settings.json'), 'utf8'), '{"credential":"synthetic-only"}');
  // Upgrade removes only a previously owned stale extension.
  fs.rmSync(path.join(source, 'agent/extensions/one.ts'));
  build('two.ts'); seal(); run('activate'); run('check');
  assert.equal(fs.existsSync(live('agent/extensions/one.ts')), false);
  // Unknown extensions cannot load silently; an explicit user-owned hash allowlist preserves them.
  write(live('agent/extensions/custom.ts'), 'user code');
  run('check', false); run('prepare', false);
  write(path.join(home, '.pi/neura-user-extensions.json'), JSON.stringify({schemaVersion:1, extensions:{'custom.ts':sha(live('agent/extensions/custom.ts'))}}));
  run('check');
  write(live('agent/extensions/custom.ts'), 'changed'); run('check', false);
  write(live('agent/extensions/custom.ts'), 'user code');
  write(live('agent/mcp.json'), '{"user":"owned"}');
  run('prepare', false); // refuse to overwrite edited live configuration
  write(live('agent/mcp.json'), '{}');
  // Tamper detection checks bytes, not normalized text or a lockfile-only receipt.
  write(live('agent/extensions/two.ts'), 'tampered'); run('check', false);
  write(live('agent/extensions/two.ts'), 'two.ts');
  seal(); run('activate', false, {NEURA_INSTALL_TEST_FAIL_AFTER:'2'});
  assert.equal(fs.readFileSync(live('agent/extensions/two.ts'), 'utf8'), 'two.ts', 'failed activation did not roll back');
  assert.equal(fs.readFileSync(live('agent/settings.json'), 'utf8'), '{"credential":"synthetic-only"}');
  run('check');
  // A forged previous receipt cannot claim a private file as a stale managed file.
  const receiptPath = live('agent/neura/.install-state.json');
  const originalReceipt = fs.readFileSync(receiptPath, 'utf8');
  const forgedReceipt = JSON.parse(originalReceipt);
  forgedReceipt.files['agent/neura/MEMORY.md'] = sha(live('agent/extensions/two.ts'));
  write(receiptPath, JSON.stringify(forgedReceipt));
  run('prepare', false);
  write(receiptPath, originalReceipt);
  // Abrupt process death leaves an actual stage, backups and journal to recover.
  const pending = path.join(home, '.pi/neura-install-pending');
  seal(); run('activate', false, {NEURA_INSTALL_TEST_CRASH_AFTER:'2'});
  run('check', false); run('prepare', false); run('recover');
  assert.equal(fs.readFileSync(live('agent/extensions/two.ts'), 'utf8'), 'two.ts');
  run('check');
  // Recovery must refuse an allowed-namespace private path, not only traversal.
  write(live('agent/neura/MEMORY.md'), 'private');
  seal();
  write(path.join(pending, 'journal.json'), JSON.stringify(['agent/neura/MEMORY.md']));
  run('recover', false);
  assert.equal(fs.readFileSync(live('agent/neura/MEMORY.md'), 'utf8'), 'private');
  fs.rmSync(pending, {recursive:true, force:true});
  console.log('PASS synthetic managed release install, upgrade, ownership, drift, rollback, interruption');
} finally { fs.rmSync(tmp, {recursive:true, force:true}); }

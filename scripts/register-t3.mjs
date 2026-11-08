// Local-development registration via T3's serialized provider-instance API; never replaces settings.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export function registrationMutation(instances, commandPath, entry) {
  const instance = {
    driver: 'acpRegistry', displayName: 'Neura', enabled: true,
    environment: [{ name: 'NEURA_PROVIDER', value: 'openai-codex', sensitive: false }],
    config: { source: 'local', commandPath, commandArgs: [entry] },
  };
  if (instances?.neura) {
    const current = instances.neura;
    const sameCommand = current.driver === instance.driver && current.enabled !== false && current.config?.source === 'local'
      && current.config.commandPath === commandPath && JSON.stringify(current.config.commandArgs) === JSON.stringify([entry]);
    const subscription = current.environment?.some(variable => variable.name === 'NEURA_PROVIDER' && variable.value === 'openai-codex');
    if (!sameCommand || !subscription) throw new Error('An existing Neura instance differs. Review it manually; nothing was overwritten.');
    return null;
  }
  return { operation: 'create', instanceId: 'neura', instance };
}

function t3Auth(baseDir, args) {
  const cli = process.env.T3CODE_CLI_PATH || path.join(os.homedir(), '.t3', 'bin', 't3.cmd');
  if (!fs.statSync(cli).isFile()) throw new Error('T3 CLI is missing. Open T3 Code once to install its CLI.');
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const command = '& ' + [cli, 'auth', 'session', ...args, '--base-dir', baseDir].map(quote).join(' ');
  try {
    // Capture in memory only: bearer tokens never reach terminal output, files or command arguments.
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', stdio: 'pipe', timeout: 20000 });
  } catch { throw new Error('T3 scoped authorization command failed; credential output was withheld.'); }
}

async function requestLive(baseDir, tag, payload) {
  const runtime = JSON.parse(fs.readFileSync(path.join(baseDir, 'userdata', 'server-runtime.json'), 'utf8'));
  const origin = new URL(runtime.origin);
  if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) || origin.username || origin.password || origin.search || origin.hash) throw new Error('Registration requires the native loopback T3 server.');
  let issued;
  const scopes = tag === 'server.refreshProviders' ? ['orchestration:read'] : ['settings:write', 'providers:manage'];
  try { issued = JSON.parse(t3Auth(baseDir, ['issue', ...scopes.flatMap(scope => ['--scope', scope]), '--ttl', '2m', '--label', 'neura-local-registration', '--json'])); }
  catch { throw new Error('Could not issue the short-lived T3 registration session.'); }
  if (typeof issued.token !== 'string' || typeof issued.sessionId !== 'string') throw new Error('Invalid T3 registration session response.');
  try {
    const response = await fetch(new URL('/api/auth/websocket-ticket/rpc', origin), {
      method: 'POST', headers: { Authorization: `Bearer ${issued.token}` }, signal: AbortSignal.timeout(10000), redirect: 'error',
    });
    if (!response.ok) throw new Error('T3 refused the scoped registration connection.');
    const ticket = await response.json();
    if (typeof ticket.ticket !== 'string') throw new Error('T3 returned no WebSocket ticket.');
    const url = new URL('/ws', origin); url.protocol = 'ws:';
    url.searchParams.set('orchestrationProtocol', '2'); url.searchParams.set('wsTicket', ticket.ticket);
    return await new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      let settled = false;
      const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); socket.close(); error ? reject(error) : resolve(value); };
      const timer = setTimeout(() => finish(new Error('T3 request timed out. Inspect the Neura provider before retrying.')), 60000);
      socket.onopen = () => socket.send(JSON.stringify({ _tag: 'Request', id: 'neura-registration', tag, headers: [], payload }));
      socket.onerror = () => finish(new Error('T3 registration connection failed.'));
      socket.onclose = () => finish(new Error('T3 registration connection closed before confirmation.'));
      socket.onmessage = event => {
        try {
          const decoded = JSON.parse(String(event.data));
          for (const frame of Array.isArray(decoded) ? decoded : [decoded]) {
            if (frame._tag === 'Ping') { socket.send(JSON.stringify({ _tag: 'Pong' })); continue; }
            if (frame._tag !== 'Exit' || frame.requestId !== 'neura-registration') continue;
            if (frame.exit?._tag !== 'Success') return finish(new Error('T3 refused the Neura provider request.'));
            finish(undefined, frame.exit.value);
          }
        } catch { finish(new Error('T3 returned an unsupported registration response.')); }
      };
    });
  } catch (error) {
    // Do not expose transport errors, which can include a one-use credential URL.
    throw new Error(error instanceof Error && error.message.startsWith('T3 ') ? error.message : 'T3 registration failed; no credentials were printed.');
  } finally {
    try { t3Auth(baseDir, ['revoke', issued.sessionId]); }
    catch { console.error('The temporary T3 registration session could not be revoked; it expires within two minutes.'); }
    issued.token = '';
  }
}

async function mutateLive(baseDir, mutation) {
  const result = await requestLive(baseDir, 'server.updateSettings', { patch: {}, providerInstanceMutation: mutation });
  if (result?.providerInstances?.neura?.driver !== 'acpRegistry') throw new Error('T3 did not confirm Neura registration. Existing instances were not overwritten.');
}

export async function probeT3(baseDir = process.env.T3CODE_HOME || path.join(os.homedir(), '.t3')) {
  const result = await requestLive(baseDir, 'server.refreshProviders', { instanceId: 'neura', fresh: true, refreshModels: true });
  if (result?.providers?.find(provider => provider.instanceId === 'neura')?.status !== 'ready') throw new Error('T3 could not create the Neura test session. Inspect the Neura provider before retrying.');
}

export async function registerT3({ apply = false, baseDir = process.env.T3CODE_HOME || path.join(os.homedir(), '.t3'), commandPath = process.execPath,
  entry = fileURLToPath(new URL('../src/acp.ts', import.meta.url)), mutate = mutateLive } = {}) {
  if (process.platform !== 'win32') throw new Error('Register on the native Windows host that runs T3 Code.');
  const settings = path.join(baseDir, 'userdata', 'settings.json');
  const stat = fs.lstatSync(settings);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('Refusing linked or non-regular T3 settings.');
  if (!fs.statSync(entry).isFile()) throw new Error('Neura ACP entry point missing.');
  const config = JSON.parse(fs.readFileSync(settings, 'utf8').replace(/^\uFEFF/, ''));
  const mutation = registrationMutation(config.providerInstances, commandPath, entry);
  if (!mutation) return true;
  if (!apply) return false;
  await mutate(baseDir, mutation);
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flag = process.argv[2];
  if (process.argv.length !== 3 || !['--check', '--apply', '--probe'].includes(flag)) { console.error('Use --check (registration metadata), --apply (register Neura), or --probe (T3 test session).'); process.exitCode = 2; }
  else try {
    const registered = await registerT3({ apply: flag === '--apply' });
    if (registered && flag === '--probe') {
      await probeT3();
      console.log('PASS: T3 created the Neura test session; provider is ready. Development/testing only.');
    } else console.log(registered ? 'PASS: Neura local ACP provider is registered. Development/testing only.' : 'NOT REGISTERED: Neura local ACP provider is absent.');
    if (!registered) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

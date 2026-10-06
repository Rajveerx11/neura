// Release/CI discovery only. Never installs Pi or changes a live profile.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const stable = /^\d+\.\d+\.\d+$/;
export function validatePiRelease(contract, manifest, latest) {
  const pin = contract?.piVersion;
  assert.equal(contract?.schemaVersion, 1, 'invalid Neura runtime contract');
  assert.equal(typeof pin, 'string', 'missing Pi pin');
  assert.match(pin, stable, 'Pi pin must be an exact stable version');
  assert.equal(typeof latest?.version, 'string', 'registry did not return a Pi version');
  assert.match(latest.version, stable, 'registry latest Pi must be stable');
  assert.equal(latest.version, pin, `Latest Pi ${latest.version} differs from reviewed ${pin}; update and validate Neura, never downgrade Pi`);
  for (const name of ['pi-ai', 'pi-coding-agent', 'pi-tui']) {
    assert.equal(manifest?.devDependencies?.[`@earendil-works/${name}`], pin, `${name} and runtime contract differ`);
  }
  return pin;
}

export async function fetchLatestPi(fetcher = fetch) {
  const response = await fetcher('https://registry.npmjs.org/@earendil-works%2fpi-coding-agent/latest', {
    signal: AbortSignal.timeout(15_000), redirect: 'error',
  });
  if (!response.ok || !response.body) throw Error('Cannot verify latest stable Pi; release remains blocked');
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 128 * 1024) throw Error('Pi registry response exceeds limit');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 2, 'check-pi-release accepts no version override');
    const root = path.resolve(import.meta.dirname, '..');
    const contract = JSON.parse(fs.readFileSync(path.join(root, 'agent/neura/runtime-contract.json'), 'utf8'));
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const version = validatePiRelease(contract, manifest, await fetchLatestPi());
    console.log(`Latest stable Pi ${version} matches Neura's exact development/runtime pins (checked ${new Date().toISOString()}). Compatibility tests remain required.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Cannot verify latest stable Pi');
    process.exitCode = 1;
  }
}

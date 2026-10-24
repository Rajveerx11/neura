// Synthetic runtime bytes only: no provider, auth, real model or vendor execution.
import fs from 'node:fs';
import path from 'node:path';
export const piName = '@earendil-works/pi-coding-agent';
export const runtimeMetadata = ['owned-pi.mjs', 'runtime-contract.json', 'package.json', 'package-lock.json'];
const write = (root, name, value) => {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
};
export function runtimeDeclarations(root) {
  write(root, 'owned-pi.mjs', fs.readFileSync(new URL('../../agent/neura/owned-pi.mjs', import.meta.url), 'utf8'));
  write(root, 'runtime-contract.json', { schemaVersion: 1, piVersion: '1.4.0' });
  const dependencies = { [piName]: '1.4.0', undici: '8.12.2' };
  write(root, 'package.json', { type: 'module', dependencies, overrides: { 'undici@8.10.2': '8.12.2' } });
  write(root, 'package-lock.json', { lockfileVersion: 3, packages: { '': { dependencies },
    [`node_modules/${piName}`]: { version: '1.4.0' }, 'node_modules/undici': { version: '8.12.2' } } });
}
export function runtimeModules(root) {
  write(root, `node_modules/${piName}/package.json`, { name: piName, type: 'module', version: '1.4.0' });
  write(root, `node_modules/${piName}/dist/cli.js`, 'console.log(JSON.stringify({argv:process.argv.slice(2),neura:process.env.NEURA,agent:process.env.PI_CODING_AGENT_DIR})); process.exitCode=7;');
  write(root, `node_modules/${piName}/dist/core/http-dispatcher.js`, '// synthetic dispatcher');
  write(root, `node_modules/${piName}/dist/main.js`, '// synthetic imported main');
  write(root, `node_modules/${piName}/dist/cli/setup.js`, '// synthetic imported setup');
  write(root, 'node_modules/undici/package.json', { name: 'undici', version: '8.12.2', main: 'index.js' });
  write(root, 'node_modules/undici/index.js', '// synthetic fixed external module');
}

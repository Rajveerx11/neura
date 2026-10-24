// Exercise Neura's production-selected private unbundled dispatcher, not stock Pi.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { once } from 'node:events';
import { gzipSync } from 'node:zlib';
import { finished } from 'node:stream/promises';
import { isolate } from './isolation.mjs';
import { pathToFileURL } from 'node:url';
import { resolveOwnedPi } from '../../agent/neura/owned-pi.mjs';

isolate();
const runtimeRoot = path.resolve(import.meta.dirname, '../../agent/neura');
const release = JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'release-manifest.json'), 'utf8'));
const runtime = resolveOwnedPi(runtimeRoot, { release });
const requireFromPi = createRequire(runtime.dispatcher);
const undiciEntry = requireFromPi.resolve('undici');
assert.equal(undiciEntry, runtime.undiciEntry, 'production dispatcher did not resolve the fixed owned module');
const undiciRoot = path.dirname(undiciEntry);
const manifest = JSON.parse(fs.readFileSync(path.join(undiciRoot, 'package.json'), 'utf8'));
assert.equal(manifest.version, '8.12.2', 'Pi resolved the vulnerable npm Undici');
const fixedUndici = requireFromPi('undici');
const { configureHttpDispatcher } = await import(pathToFileURL(runtime.dispatcher).href);
configureHttpDispatcher(3_000);
assert.equal(globalThis.fetch, fixedUndici.fetch, 'production dispatcher did not install the fixed external fetch');
const { fetch } = globalThis;
const { EventSourceStream } = requireFromPi(path.join(undiciRoot, 'lib/web/eventsource/eventsource-stream.js'));

// Bounded parser inputs test retained fields, data-line nodes and chunk wrappers.
async function parseEvents(chunks, maxEventSize = 64) {
  const events = [];
  const parser = new EventSourceStream({ maxEventSize, push(event) { if (event) events.push(event); return true; } });
  const complete = finished(parser, { readable: false });
  // Observe rejection before feeding input so synchronous parser errors stay handled.
  const settled = complete.then(() => null, error => error);
  for (const chunk of chunks) {
    const error = await new Promise(resolve => parser.write(Buffer.from(chunk), failure => resolve(failure)));
    if (error) break;
  }
  parser.end();
  const error = await settled;
  return { parser, events, error };
}
const valid = await parseEvents(['id: one\nevent: notice\nretry: 20\ndata: hello\n', 'data: world\n\n']);
assert.equal(valid.error, null);
assert.equal(valid.events.length, 1);
assert.equal(valid.events[0].type, 'notice');
assert.equal(valid.events[0].options.data, 'hello\nworld');
assert.equal(valid.events[0].options.lastEventId, 'one');
assert.equal(valid.parser.state.reconnectionTime, 20);
const replaced = await parseEvents(Array(8).fill('id: ' + 'x'.repeat(32) + '\n').concat('data: ok\n\n'));
assert.equal(replaced.error, null, 'replacement fields were incorrectly accumulated');
assert.equal(replaced.events[0].options.data, 'ok');
const released = await parseEvents(Array(1024).fill('x').concat('\ndata: ok\n\n'), 131_072);
assert.equal(released.error, null, 'line ending did not release the final allowed chunk slot');
assert.equal(released.events[0].options.data, 'ok');
for (const chunks of [
  ['data: ' + 'd'.repeat(40) + '\nid: ' + 'i'.repeat(40) + '\n'],
  ['event: ' + 'e'.repeat(65) + '\n'],
  ['retry: ' + '1'.repeat(65) + '\n'],
  Array(1025).fill('x'),
  Array(1025).fill('data:\n'),
]) {
  const { parser, error } = await parseEvents(chunks, chunks.length > 1000 ? 131_072 : 64);
  assert.match(error?.message ?? '', /message size exceeded/i, 'oversized retained EventSource state was accepted');
  assert.equal(parser.chunks.length, 0, 'destroy retained input chunks');
  assert.equal(parser.eventSize, 0, 'destroy retained decoded fields');
  assert.equal(parser.dataLineCount, 0, 'destroy retained data nodes');
}

const body = Buffer.from('synthetic integrity and encoding response');
const server = http.createServer((request, response) => {
  if (request.url === '/gzip') {
    response.writeHead(200, { 'content-encoding': 'gzip, gzip' });
    response.end(gzipSync(gzipSync(body)));
  } else if (request.url === '/excess') {
    response.writeHead(200, { 'content-encoding': Array(6).fill('gzip').join(', ') });
    response.end(gzipSync(body));
  } else response.end(body);
});
const agent = fixedUndici.getGlobalDispatcher();
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const options = () => ({ signal: AbortSignal.timeout(3_000) });
  assert.equal(await (await fetch(`${base}/gzip`, options())).text(), body.toString());
  await assert.rejects(fetch(`${base}/excess`, options()), error => /too many content-encodings/.test(error.cause?.message ?? ''));
  assert.equal(await (await fetch(`${base}/gzip`, options())).text(), body.toString(), 'encoding rejection poisoned later requests');
  for (const algorithm of ['sha256', 'sha384', 'sha512']) {
    const digest = createHash(algorithm).update(body).digest('base64');
    const badDigest = createHash(algorithm).update('tampered').digest('base64');
    for (const token of [algorithm, algorithm.toUpperCase(), algorithm.replace('sha', 'sHa')]) {
      const correct = await fetch(base, { ...options(), integrity: `${token}-${digest}` });
      assert.equal(await correct.text(), body.toString(), `correct ${token} integrity failed`);
      await assert.rejects(fetch(base, { ...options(), integrity: `${token}-${badDigest}` }), error => /integrity mismatch/i.test(error.cause?.message ?? ''));
    }
  }
} finally {
  await agent.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
console.log(`PASS owned unbundled Pi ${runtime.version} / npm Undici ${manifest.version}: bounded EventSource retention, encoding decode/rejection, mixed-case SRI match/mismatch; Node bundled ${process.versions.undici ?? 'unknown'} unchanged`);

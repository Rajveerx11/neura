// Portable source-only contract check; no Windows policy/installer machinery.
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { executeProcess } from '../../agent/neura/process.ts';
import { runProcess } from '../../agent/neura/core.ts';
import { execute } from '../../agent/neura/verification.ts';

const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'neura-process-contract-'));
let fixtureWritesFenced = true;
const options = { cwd, timeoutMs: 5000, maxBuffer: 1024 };
const run = (script, overrides = {}, args = []) => executeProcess(process.execPath, ['-e', script, '--', ...args], { ...options, ...overrides });
try {
  const success = await run('process.stdout.write("  out\\n"); process.stderr.write("  err\\n")');
  assert.equal(success.ok, true);
  assert.equal(success.completed, true);
  assert.equal(success.termination, 'exited');
  assert.equal(success.exitCode, 0);
  assert.equal(success.signal, null);
  assert.equal(success.errorCode, null);
  assert.equal(success.cancelled, false);
  assert.equal(success.timedOut, false);
  assert.equal(success.stdout, '  out\n');
  assert.equal(success.stderr, '  err\n');
  assert.ok(Number.isFinite(success.durationMs) && success.durationMs >= 0 && success.durationMs < 5000);
  const nulScript = 'process.stdout.write("a\\0b"); process.stderr.write("c\\0d")';
  const nul = await run(nulScript);
  assert.equal(nul.stdout, 'a\0b');
  assert.equal(nul.stderr, 'c\0d');
  assert.deepEqual(await execute(process.execPath, ['-e', nulScript], options), { ok: true, completed: true, stdout: 'a\0b' });
  // Script-looking arguments remain data, including leading Node option text.
  const argvData = ['"; process.exit(73); //\n', '--eval=process.exit(74)', '7'];
  const echoed = await run('process.stdout.write(JSON.stringify(process.argv.slice(1)))', {}, argvData);
  assert.equal(echoed.ok, true);
  assert.equal(echoed.exitCode, 0);
  assert.deepEqual(JSON.parse(echoed.stdout), argvData);
  const nonzero = await run('process.exit(7)');
  assert.equal(nonzero.ok, false);
  assert.equal(nonzero.completed, true);
  assert.equal(nonzero.termination, 'exited');
  assert.equal(nonzero.exitCode, 7);
  assert.equal(nonzero.signal, null);
  assert.equal(nonzero.errorCode, null);
  assert.equal(nonzero.timedOut, false);
  assert.deepEqual(await runProcess(process.execPath, ['-e', 'process.stdout.write("  out\\n"); process.stderr.write("  err\\n")'], options), { ok: true, stdout: 'out', stderr: 'err' });
  assert.deepEqual(await execute(process.execPath, ['-e', 'process.stdout.write("out\\n"); process.exit(7)'], options), { ok: false, completed: true, stdout: 'out\n' });

  const missing = await executeProcess(path.join(cwd, 'missing'), [], options);
  assert.equal(missing.termination, 'spawn-failed');
  assert.equal(missing.errorCode, 'ENOENT');
  assert.equal(missing.signal, null);
  assert.equal(missing.exitCode, null);
  assert.equal(missing.completed, false);
  for (const [file, args, overrides, code] of [
    ['', [], {}, 'ERR_INVALID_ARG_VALUE'],
    ['bad\0file', [], {}, 'ERR_INVALID_ARG_VALUE'],
    [process.execPath, ['bad\0arg'], {}, 'ERR_INVALID_ARG_VALUE'],
    [process.execPath, [], { timeoutMs: -1 }, 'ERR_OUT_OF_RANGE'],
    [process.execPath, [], { timeoutMs: 0.5 }, 'ERR_OUT_OF_RANGE'],
    [process.execPath, [], { timeoutMs: '100' }, 'ERR_OUT_OF_RANGE'],
    [process.execPath, [], { maxBuffer: -1 }, 'ERR_OUT_OF_RANGE'],
    [process.execPath, [], { signal: {} }, 'ERR_INVALID_ARG_TYPE'],
  ]) await assert.rejects(executeProcess(file, args, { ...options, ...overrides }), { code });
  const noTimeout = await run('setTimeout(() => process.exit(0), 100)', { timeoutMs: 0 });
  assert.equal(noTimeout.ok, true);
  assert.equal(noTimeout.timedOut, false);

  const realDateNow = Date.now;
  let timeout;
  try {
    Date.now = () => -1; // duration must remain monotonic, not wall-clock based.
    timeout = await run('setInterval(() => {}, 1000)', { timeoutMs: 100 });
  } finally { Date.now = realDateNow; }
  assert.equal(timeout.ok, false);
  assert.equal(timeout.completed, false);
  assert.equal(timeout.termination, 'timed-out');
  assert.equal(timeout.timedOut, true);
  assert.equal(timeout.cancelled, false);
  assert.equal(timeout.signal, 'SIGTERM');
  assert.equal(timeout.exitCode, null);
  assert.ok(timeout.durationMs >= 75 && timeout.durationMs < 5000);

  const controller = new AbortController();
  const pending = run('setInterval(() => {}, 1000)', { signal: controller.signal, timeoutMs: 1000 });
  const abortTimer = setTimeout(() => controller.abort(), 100);
  const abort = await pending.finally(() => clearTimeout(abortTimer));
  for (const outcome of [abort, await run('setInterval(() => {}, 1000)', { signal: AbortSignal.abort(), timeoutMs: 1000 })]) {
    assert.equal(outcome.ok, false);
    assert.equal(outcome.completed, false);
    assert.equal(outcome.termination, 'cancelled');
    assert.equal(outcome.errorCode, 'ABORT_ERR');
    assert.equal(outcome.cancelled, true);
    assert.equal(outcome.timedOut, false);
    assert.ok(outcome.durationMs < 5000);
  }
  for (const stream of ['stdout', 'stderr']) {
    const overflow = await run(`process.${stream}.write("x".repeat(8192))`, { maxBuffer: 32, timeoutMs: 1000 });
    assert.equal(overflow.ok, false);
    assert.equal(overflow.completed, false);
    assert.equal(overflow.termination, 'output-limit');
    assert.equal(overflow.errorCode, 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER');
    assert.equal(overflow.timedOut, false);
    assert.equal(overflow[stream].length, 32);
  }

  if (process.platform !== 'win32') {
    // Parent observes readiness after the handler is installed, before awaiting
    // timeout completion. Never accept an unready child as a cooperative probe.
    let serial = 0;
    async function cooperative(invoke, exitCode) {
      const ready = path.join(cwd, `ready-${serial++}`);
      const script = 'process.on("SIGTERM", () => process.exit(Number(process.argv[2]))); require("node:fs").writeFileSync(process.argv[1], "ready"); process.stdout.write("  ready\\n"); setInterval(() => {}, 1000)';
      const promise = invoke(script, [ready, String(exitCode)]);
      let finished = false;
      promise.then(() => { finished = true; }, () => { finished = true; });
      let observed = false;
      while (!finished) {
        try { observed = await fs.readFile(ready, 'utf8') === 'ready'; } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (observed) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      const result = await promise;
      assert.equal(observed, true, 'child must be ready before deadline callback');
      return result;
    }
    for (const exitCode of [0, 7]) {
      const result = await cooperative((script, args) => run(script, { timeoutMs: 1500 }, args), exitCode);
      assert.equal(result.ok, false);
      assert.equal(result.completed, false);
      assert.equal(result.termination, 'timed-out');
      assert.equal(result.timedOut, true);
      assert.equal(result.cancelled, false);
      assert.equal(result.exitCode, exitCode);
      assert.equal(result.signal, null);
      assert.equal(result.errorCode, null);
      assert.equal(result.stdout, '  ready\n');
      assert.ok(result.durationMs >= 1400 && result.durationMs < 5000);
      assert.deepEqual(await cooperative((script, args) => runProcess(process.execPath, ['-e', script, '--', ...args], { ...options, timeoutMs: 1500 }), exitCode), { ok: false, stdout: 'ready', stderr: '' });
      assert.deepEqual(await cooperative((script, args) => execute(process.execPath, ['-e', script, '--', ...args], { ...options, timeoutMs: 1500 }), exitCode), { ok: false, completed: false, stdout: '  ready\n' });
    }
    // The deadline and native abort are independent facts. Observe a real
    // SIGTERM handler before aborting, rather than guessing from elapsed time.
    for (const deadlineFirst of [true, false]) {
      const ready = path.join(cwd, `race-ready-${serial++}`);
      const terminated = `${ready}-terminated`;
      const writesDone = `${ready}-writes-done`;
      const controller = new AbortController();
      // finish publishes the last fixture write, not proof of physical exit.
      const script = 'const fs = require("node:fs"); const finish = () => { fs.writeFileSync(process.argv[3], "done"); process.exit(0); }; let stopping = false; process.on("SIGTERM", () => { if (stopping) return; stopping = true; fs.writeFileSync(process.argv[2], "ready"); setTimeout(finish, 1000); }); fs.writeFileSync(process.argv[1], "ready"); setTimeout(finish, 5000)';
      fixtureWritesFenced = false;
      const pending = run(script, { timeoutMs: 1500, signal: controller.signal }, [ready, terminated, writesDone]);
      let finished = false;
      pending.finally(() => { finished = true; });
      try {
        for (const marker of deadlineFirst ? [ready, terminated] : [ready]) {
          let observed = false;
          while (!finished) {
            try { observed = await fs.readFile(marker, 'utf8') === 'ready'; } catch (error) { if (error.code !== 'ENOENT') throw error; }
            if (observed) break;
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          assert.equal(observed, true, `race marker not observed before callback: ${marker}`);
        }
        controller.abort();
        const result = await pending;
        assert.equal(result.ok, false);
        assert.equal(result.completed, false);
        assert.equal(result.termination, 'cancelled');
        assert.equal(result.cancelled, true);
        assert.equal(result.errorCode, 'ABORT_ERR');
        assert.equal(result.timedOut, deadlineFirst, 'abort erased a deadline fact or invented expiry');
      } finally {
        controller.abort();
        await pending;
        // Abort callback can precede the signal handler's fixture writes. Keep
        // cwd until their final marker, bounded beyond the child's 5s fallback.
        const fenceDeadline = performance.now() + 6500;
        let observed = false;
        while (performance.now() < fenceDeadline) {
          try { observed = await fs.readFile(writesDone, 'utf8') === 'done'; } catch (error) { if (error.code !== 'ENOENT') throw error; }
          if (observed) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(observed, true, 'race fixture writes did not finish before cleanup bound');
        fixtureWritesFenced = true;
        assert.equal(await fs.readFile(ready, 'utf8'), 'ready');
        assert.equal(await fs.readFile(terminated, 'utf8'), 'ready', 'signal fixture must survive until all writes are fenced');
      }
    }
    console.log('Process contract: POSIX ready-confirmed cooperative exit 0/7, both adapters, deadline/abort fact ordering and fixture-write fences passed.');
  } else console.log('Process contract: POSIX cooperative probes skipped on Windows.');
  console.log('Process contract: success/nonzero, validation, zero timeout, expiry, cancellation, output limits and duration passed.');
} finally {
  assert.equal(fixtureWritesFenced, true, `unsafe fixture cleanup refused; retained ${cwd}`);
  await fs.rm(cwd, { recursive: true, force: true });
}

import { PassThrough } from 'node:stream';
import type { Interface } from 'node:readline/promises';
import { commandMatches, type MenuItem } from './terminal-ui.ts';

type Menu = { commandMenu(items: MenuItem[], selected: number): string[]; width: number };
type Raw = NodeJS.ReadStream & { setRawMode(mode: boolean): unknown };

/**
 * Live slash-command menu for the real readline prompt. Raw keys pass through a filter before readline sees
 * them, so the open menu can claim Up/Down, Tab, Enter and Esc; every other key reaches readline unchanged.
 * Only public readline APIs are used: `line`, `getCursorPos()` and `write()`.
 */
export function createCommandKeyboard(stdin: Raw, stdout: NodeJS.WriteStream) {
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (mode: boolean) => stdin.setRawMode(mode) });
  let claim: ((key: string) => boolean) | undefined;
  const onData = (chunk: Buffer | string) => { const key = String(chunk); if (!claim?.(key)) input.write(key); };
  const onEnd = () => input.end();
  stdin.setEncoding('utf8');
  stdin.on('data', onData);
  stdin.once('end', onEnd);

  function attach(rl: Interface, ui: () => Menu, active: () => boolean) {
    let items: MenuItem[] = [];
    let selected = 0;
    let shown = 0;
    let lastLine = '';
    let dismissed: string | undefined;
    const column = () => rl.getCursorPos().cols + 1;
    const clear = () => {
      if (!shown) return;
      stdout.write(`\r\n\x1b[J\x1b[1A\x1b[${column()}G`);
      shown = 0;
    };
    const draw = () => {
      const rows = ui().commandMenu(items, selected);
      stdout.write(`\r\n\x1b[J${rows.join('\r\n')}\x1b[${rows.length}A\x1b[${column()}G`);
      shown = rows.length;
    };
    const update = () => {
      const line = rl.line;
      if (line !== lastLine) { selected = 0; lastLine = line; if (line !== dismissed) dismissed = undefined; }
      // ponytail: single-row input only; a wrapped prompt would need row tracking for the redraw.
      items = active() && line !== dismissed && rl.getCursorPos().rows === 0 ? commandMatches(line) : [];
      if (items.length) draw(); else clear();
    };
    const accept = (item: MenuItem, run: boolean) => {
      clear();
      rl.write(null, { ctrl: true, name: 'e' });
      rl.write(null, { ctrl: true, name: 'u' });
      rl.write(run ? item.value : item.value + ' ');
      if (run) rl.write(null, { name: 'return' });
      else update();
    };
    claim = key => {
      if (!shown || !items.length) { if (/[\r\n]/.test(key)) clear(); return false; }
      const item = items[selected];
      if (key === '\x1b[A' || key === '\x1bOA') { selected = (selected + items.length - 1) % items.length; draw(); return true; }
      if (key === '\x1b[B' || key === '\x1bOB') { selected = (selected + 1) % items.length; draw(); return true; }
      if (key === '\t') { accept(item, false); return true; }
      if (key === '\x1b') { dismissed = rl.line; clear(); return true; }
      if (key === '\r' || key === '\n') {
        if (rl.line.trim() === item.value && item.submit) { clear(); return false; }
        accept(item, item.submit);
        return true;
      }
      if (/[\r\n\x03\x04]/.test(key)) clear();
      return false;
    };
    // Readline registered its keypress listener first, so this runs after it has updated `rl.line`.
    input.on('keypress', () => setImmediate(update));
    stdout.on('resize', update);
    rl.once('close', () => {
      claim = undefined;
      stdin.off('data', onData); stdin.off('end', onEnd); stdout.off('resize', update);
      stdin.pause();
    });
    return { clear };
  }
  return { input, attach };
}

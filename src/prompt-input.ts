import { addAbortListener } from 'node:events';
import { PassThrough } from 'node:stream';
import type { Interface } from 'node:readline/promises';
import { commandMatches, type createTerminalUI, type MenuItem } from './terminal-ui.ts';

type Raw = NodeJS.ReadStream & { setRawMode(mode: boolean): unknown };
const moveRows = (rows: number) => rows ? `\x1b[${Math.abs(rows)}${rows < 0 ? 'A' : 'B'}` : '';
const column = (cols: number) => `\x1b[${cols + 1}G`;

export function clearDraft(rl: Interface) {
  if (!rl.line) return;
  rl.write(null, { ctrl: true, name: 'e' });
  rl.write(null, { ctrl: true, name: 'u' });
}

/**
 * Readline owns the draft and its cursor. Draw the lower border and menus outside its edit area.
 */
export function createCommandKeyboard(stdin: Raw, stdout: NodeJS.WriteStream) {
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (mode: boolean) => stdin.setRawMode(mode) });
  let claim: ((key: string) => boolean) | undefined;
  const onData = (chunk: Buffer | string) => { const key = String(chunk); if (!claim?.(key)) input.write(key); };
  const onEnd = () => input.end();
  stdin.setEncoding('utf8');
  stdin.on('data', onData);
  stdin.once('end', onEnd);

  function attach(rl: Interface, ui: () => ReturnType<typeof createTerminalUI>, matches: (line: string) => MenuItem[] = commandMatches,
    footer: () => string[] = () => []) {
    const makeFrame = (query: string) => stdout.columns >= 32 && stdout.rows >= 4 ? ui().composer(query) : undefined;
    let prompt: string | undefined;
    let frame: ReturnType<typeof makeFrame>;
    let items: MenuItem[] = [];
    let selected = 0;
    let shown = false;
    let lastLine = '';
    let dismissed: string | undefined;
    let closed = false;
    let pending: NodeJS.Immediate | undefined;
    const endPosition = () => {
      // Use readline's own cell widths for wraps, tabs and wide characters without moving the terminal cursor.
      const editor = rl as Interface & { cursor: number };
      const cursor = editor.cursor;
      editor.cursor = editor.line.length;
      try { return editor.getCursorPos(); } finally { editor.cursor = cursor; }
    };
    const clear = () => {
      if (!shown) return;
      const cursor = rl.getCursorPos(), end = endPosition();
      const distance = end.rows - cursor.rows;
      stdout.write(moveRows(distance) + column(end.cols) + '\x1b[J' + moveRows(-distance) + column(cursor.cols));
      shown = false;
    };
    const unframe = (query: string) => {
      frame = undefined;
      shown = false;
      rl.setPrompt(query);
      rl.prompt(true);
    };
    const update = () => {
      if (closed || prompt === undefined) return;
      clear();
      const line = rl.line;
      if (line !== lastLine) { selected = 0; lastLine = line; if (line !== dismissed) dismissed = undefined; }
      const cursor = rl.getCursorPos(), end = endPosition();
      const singleRow = end.rows === (frame ? 1 : 0);
      // Leave the bottom row free when the draft fills the terminal.
      const room = stdout.rows - end.rows - 1;
      const bottom = frame && room > 0 ? frame.bottom : '';
      const right = stdout.columns - 2;
      // shortcut: wrapped drafts use readline's full width, so only single rows have a right edge.
      const side = frame && singleRow && end.cols < right ? column(right) + frame.side : '';
      const menuRows = Math.min(8, room - Number(Boolean(bottom)) - 1);
      items = singleRow && line !== dismissed && stdout.columns >= 20 && menuRows > 0 ? matches(line) : [];
      selected = Math.min(selected, Math.max(0, items.length - 1));
      const rows = bottom ? [bottom] : [];
      if (items.length) rows.push(...ui().commandMenu(items, selected, menuRows));
      // The status bar yields to the command menu, like the composer's own hint rows.
      else if (bottom) rows.push(...footer().slice(0, Math.max(0, room - rows.length)));
      if (!side && !rows.length) return;
      const distance = end.rows - cursor.rows;
      stdout.write(moveRows(distance) + side + rows.map(row => '\r\n' + row).join('') +
        moveRows(-distance - rows.length) + column(cursor.cols));
      shown = true;
    };
    const accept = (item: MenuItem, run: boolean, query: string) => {
      rl.write(null, { ctrl: true, name: 'e' });
      rl.write(null, { ctrl: true, name: 'u' });
      rl.write(run ? item.value : item.value + ' ');
      if (!run) { update(); return; }
      if (frame) unframe(query);
      rl.write(null, { name: 'return' });
    };
    claim = key => {
      if (closed || prompt === undefined) return false;
      const item = shown && rl.line === lastLine ? items[selected] : undefined;
      clear();
      if (item) {
        if (key === '\x1b[A' || key === '\x1bOA') { selected = (selected + items.length - 1) % items.length; update(); return true; }
        if (key === '\x1b[B' || key === '\x1bOB') { selected = (selected + 1) % items.length; update(); return true; }
        if (key === '\t') { accept(item, false, prompt); return true; }
        if (key === '\x1b') { dismissed = rl.line; update(); return true; }
        if ((key === '\r' || key === '\n') && !(rl.line.trim() === item.value && item.submit)) {
          accept(item, item.submit, prompt);
          return true;
        }
      }
      return false;
    };
    // Only an unmodified Return submits readline's question, even when a chunk contains several keys.
    const beforeKeypress = (_text: string, key?: { name?: string; meta?: boolean; ctrl?: boolean; shift?: boolean }) => {
      if (frame && prompt !== undefined && key && !key.meta && !key.ctrl && !key.shift &&
        (key.name === 'return' || key.name === 'enter')) unframe(prompt);
    };
    // Readline registered its keypress listener first, so this runs after it has updated `rl.line`.
    const onKeypress = () => {
      if (!closed && !pending) pending = setImmediate(() => { pending = undefined; update(); });
    };
    // Change the query before readline measures and redraws it for the new width.
    const onResizeStart = () => {
      if (prompt === undefined) return;
      frame = makeFrame(prompt);
      rl.setPrompt(frame?.query ?? prompt);
    };
    const onResize = () => { shown = false; update(); };
    input.prependListener('keypress', beforeKeypress);
    input.on('keypress', onKeypress);
    rl.on('SIGCONT', onKeypress);
    stdout.prependListener('resize', onResizeStart);
    stdout.on('resize', onResize);
    rl.once('close', () => {
      closed = true;
      if (pending) { clearImmediate(pending); pending = undefined; }
      claim = undefined;
      input.off('keypress', beforeKeypress);
      input.off('keypress', onKeypress);
      rl.off('SIGCONT', onKeypress);
      stdin.off('data', onData); stdin.off('end', onEnd);
      stdout.off('resize', onResizeStart); stdout.off('resize', onResize);
      stdin.pause();
    });
    return {
      async question(query: string, options: { signal: AbortSignal }) {
        if (closed || options.signal.aborted) return rl.question(query, options);
        prompt = query;
        frame = makeFrame(query);
        dismissed = undefined;
        let erasedRows = 0;
        const listener = addAbortListener(options.signal, () => {
          if (closed) return;
          // Remove the draft and frame before readline settles the question and advances one row.
          clear();
          clearDraft(rl);
          unframe('');
          erasedRows = 1;
        });
        try {
          const answer = rl.question(frame?.query ?? query, options);
          update();
          return await answer;
        } finally {
          listener[Symbol.dispose]();
          if (erasedRows) stdout.write(moveRows(-erasedRows) + column(0) + '\x1b[J');
          prompt = undefined;
        }
      },
    };
  }
  return { input, attach };
}

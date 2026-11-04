#!/usr/bin/env node
// Offline presentation preview. Import only an operator-trusted, pure renderer.
import { parseArgs, stripVTControlCharacters } from 'node:util';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scenarios = ['empty', 'work', 'learn', 'error', 'approval', 'help', 'models', 'status'];
const defaultModule = fileURLToPath(new URL('../src/terminal-ui.ts', import.meta.url));
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

/** Fixture content only; all presentation comes from the production factory. */
export function previewTranscript(ui, scenario) {
  const snapshot = { mode: 'work', provider: 'local', model: 'fixture-model', workspace: '/fixture/neura-demo', workspaceName: 'neura-demo', history: 'on', sessionState: 'new', sessionId: '00000000-0000-4000-8000-000000000001', thinking: true, messageCount: 0 };
  if (scenario === 'empty') return ui.wordmark() + '\n\n' + ui.status(snapshot) + '\n' + ui.prompt('work');
  if (scenario === 'status') return ui.statusDetails({ ...snapshot, messageCount: 2, lastTurnUsage: { inputTokens: 1234, outputTokens: 56 } });
  if (scenario === 'help') return ui.help(true);
  if (scenario === 'error') return [
    ui.prompt('work') + '/unknown',
    ui.feedback('Unknown command. Use /help.', 'error'),
    ui.feedback('Request cancelled. Inspect current state before retrying.', 'cancelled'),
    ui.prompt('work'),
  ].join('\n');
  if (scenario === 'approval') return [
    ui.approval('Run in network-disabled WSL sandbox?\nprintf "%s\\n" "demo<&>"\nTimeout: 120000 ms\nApproval applies once to this exact action.'),
    ui.approvalPrompt(),
  ].join('\n');
  if (scenario === 'models') return [
    ui.prompt('work') + '/model',
    ui.metadata([['Provider', 'openai-codex'], ['Current model', 'fixture-first']]),
    ui.modelChoice('fixture-first', 0, { catalogDefault: true, current: true }),
    ui.modelChoice('fixture-long-model-identifier-for-width-review', 1),
    ui.pickerPrompt(),
  ].join('\n');
  if (scenario === 'learn') return [
    ui.prompt('work') + '/mode learn',
    ui.feedback('Mode: learn', 'info'),
    ui.prompt('learn') + 'Explain a queue using a short example.',
    ui.boundary('waiting'),
    ui.boundary('answer'),
    'A queue serves the earliest waiting item first.',
    ui.prompt('learn'),
  ].join('\n');
  if (scenario === 'work') return [
    ui.prompt('work') + 'Explain the sample file.',
    ui.boundary('waiting'),
    ui.tool('read', 'started'),
    ui.tool('read', 'returned'),
    ui.boundary('reasoning'),
    'I will describe the sample without changing files.',
    ui.boundary('answer'),
    'The sample contains one short line. No files changed.',
    ui.feedback('Detector-only is never verified.', 'warning'),
    ui.prompt('work'),
  ].join('\n');
  throw new Error(`Unknown scenario. Choose: ${scenarios.join(', ')}.`);
}

function xml(value) {
  return value.toWellFormed().replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character]);
}

// Sufficient for these ASCII/block fixtures; not a Unicode/PTY conformance test.
function cells(grapheme) {
  if (/^\p{Mark}+$/u.test(grapheme)) return 0;
  const code = grapheme.codePointAt(0);
  return /\p{Extended_Pictographic}/u.test(grapheme) ||
    (code >= 0x1100 && (code <= 0x115f || code === 0x2329 || code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe10 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6) || code >= 0x20000)) ? 2 : 1;
}

/** Simulate terminal hard wraps; preserve the renderer's exact SGR foregrounds. */
function terminalRows(transcript, width) {
  const rows = [[]];
  let column = 0;
  let foreground = '#e8e2d8';
  const nextRow = () => { rows.push([]); column = 0; };
  function append(text, count) {
    if (column >= width || column + count > width) nextRow();
    const row = rows.at(-1);
    const last = row.at(-1);
    if (last?.foreground === foreground) { last.text += text; last.cells += count; }
    else row.push({ text, cells: count, foreground });
    column += count;
  }
  for (const token of transcript.replace(/\r\n/g, '\n').split(/(\x1b\[[0-9;]*m)/)) {
    if (token.startsWith('\x1b[')) {
      const codes = token.slice(2, -1).split(';').map(Number);
      for (let index = 0; index < codes.length; index++) {
        const code = codes[index];
        if (code === 0 || code === 39) foreground = '#e8e2d8';
        else if (code === 38 && codes[index + 1] === 2) {
          const rgb = codes.slice(index + 2, index + 5);
          if (rgb.length !== 3 || rgb.some(value => !Number.isInteger(value) || value < 0 || value > 255)) throw new Error('Invalid truecolor SGR.');
          foreground = '#' + rgb.map(value => value.toString(16).padStart(2, '0')).join('');
          index += 4;
        } else throw new Error(`Unsupported SGR code: ${code}. Preview supports reset and truecolor foregrounds only.`);
      }
      continue;
    }
    if (/[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(token)) throw new Error('Unsupported terminal control sequence in preview.');
    for (const { segment } of segmenter.segment(token)) {
      if (segment === '\n') nextRow();
      else if (segment === '\t') { const count = 8 - column % 8; for (let i = 0; i < count; i++) append(' ', 1); }
      else append(segment, cells(segment));
    }
  }
  return rows;
}

export function renderSvg(transcript, { width = 80, scenario = 'work' } = {}) {
  if (!Number.isInteger(width) || width < 20 || width > 240) throw new Error('Width must be an integer from 20 to 240.');
  const rows = terminalRows(transcript, width);
  const cellWidth = 8.4;
  const imageWidth = Math.max(360, Math.ceil(width * cellWidth + 32));
  const imageHeight = 100 + rows.length * 21;
  const label = `Synthetic fixture: ${scenario} | ${width} columns`;
  const text = rows.map((runs, row) => {
    const spans = runs.map(run => `<tspan fill="${run.foreground}"${run.cells ? ` textLength="${run.cells * cellWidth}" lengthAdjust="spacingAndGlyphs"` : ''}>${xml(run.text)}</tspan>`).join('');
    return `<text x="16" y="${84 + row * 21}">${spans}</text>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${imageWidth}" height="${imageHeight}" viewBox="0 0 ${imageWidth} ${imageHeight}" role="img" aria-labelledby="title description">
<title id="title">${xml(label)}</title>
<desc id="description">Real presentation helpers with synthetic inputs. No provider task ran. Terminal hard wrapping is simulated; keyboard and policy behavior are not tested.</desc>
<rect width="100%" height="100%" fill="#0b0c0e"/>
<g font-family="Cascadia Mono, Consolas, monospace" font-size="14" xml:space="preserve">
<text x="16" y="24" fill="#a8a39b">${xml(label)}</text>
<text x="16" y="45" fill="#7a828b" font-size="11">Pure UI export; no live provider task.</text>
<path d="M16 58 H${16 + width * cellWidth}" stroke="#2c3237"/>
${text}
</g>
</svg>\n`;
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    help: { type: 'boolean', short: 'h' }, module: { type: 'string' },
    width: { type: 'string', default: '80' }, scenario: { type: 'string', default: 'work' },
    format: { type: 'string', default: 'svg' }, output: { type: 'string' }, plain: { type: 'boolean' },
  } });
  if (values.help) {
    process.stdout.write(`Usage: node scripts/preview-terminal-ui.mjs [options]
  --module PATH    Trusted pure module exporting createTerminalUI (default: src/terminal-ui.ts)
  --width N        Terminal columns, 20-240 (default: 80)
  --scenario NAME  ${scenarios.join('|')} (default: work)
  --format FORMAT  svg|text (default: svg; text always plain)
  --plain          Render SVG without color, using NO_COLOR=""
  --output PATH    Write artifact; otherwise stdout
Only import a reviewed, side-effect-free presentation module. Never supply CLI,
provider, session or credential modules. Fixtures do not run commands/inference.
`);
    return;
  }
  const width = Number(values.width);
  if (!Number.isInteger(width) || width < 20 || width > 240) throw new Error('Width must be an integer from 20 to 240.');
  if (!scenarios.includes(values.scenario)) throw new Error(`Unknown scenario. Choose: ${scenarios.join(', ')}.`);
  if (!['svg', 'text'].includes(values.format)) throw new Error('Format must be svg or text.');
  const modulePath = values.module ? path.resolve(values.module) : defaultModule;
  const module = await import(pathToFileURL(modulePath).href);
  if (typeof module.createTerminalUI !== 'function') throw new Error('Presentation module must export createTerminalUI(options).');
  const ui = module.createTerminalUI({ isTTY: true, columns: width, env: values.plain || values.format === 'text' ? { NO_COLOR: '' } : {} });
  const transcript = previewTranscript(ui, values.scenario);
  const artifact = values.format === 'svg' ? renderSvg(transcript, { width, scenario: values.scenario }) :
    `Synthetic fixture: ${values.scenario} | ${width} columns\nPure UI export; no live provider task. Logical lines below; terminal hard wraps are not inserted.\n\n${stripVTControlCharacters(transcript)}\n`;
  if (values.output) await writeFile(path.resolve(values.output), artifact, { encoding: 'utf8', flag: 'wx' });
  else process.stdout.write(artifact);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`Preview failed: ${stripVTControlCharacters(error instanceof Error ? error.message : 'Unknown error.')}\n`);
    process.exitCode = 1;
  });
}

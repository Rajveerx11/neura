# Screenshot provenance

## Native terminal captures

Captured 2026-11-13. These PNGs show the actual `src/cli.ts` process in a native Windows console
host (`conhost.exe`), not an HTML/SVG reconstruction or a scripted renderer.
Each is an unretouched 972 × 547 window capture. No generated artwork, model
output or replacement text was composited into the images.

| Asset | State shown |
| --- | --- |
| [terminal-commands.png](terminal-commands.png) | `/` opens the live command menu, including `/clear` |
| [terminal-skills.png](terminal-skills.png) | `$` opens the installed-skill menu, reading this PC's shared skill directories |
| [terminal-clear.png](terminal-clear.png) | `/clear` confirms a new chat and returns to the Work prompt |

The process used an empty task-owned `neura-demo` workspace, an isolated
`NEURA_HOME`, `--no-history`, `--provider local` and `--model offline-demo`.
The model label was chosen for the capture. No inference, authentication,
workspace writes or skill execution occurred. Only installed skill names and
menu descriptions were shown. The skill count is specific to this machine.
The `/clear` capture starts from an idle chat, so it demonstrates the command
and prompt, not deletion of a previous model exchange. Context reset and saved
chat preservation are covered separately by synthetic CLI tests.

Capture used the Windows `PrintWindow` API on only the task-owned console,
with per-monitor DPI awareness to avoid clipping. Console size was 106 columns
by 25 rows. The first capture attempt had clipped window bounds and was
discarded before these files were saved. No private desktop window, account,
credential, document, session history or provider response was captured.

To reproduce the visible states, launch the development CLI in a disposable
empty workspace with a separate `NEURA_HOME`:

```powershell
neura --cwd C:\path\to\neura-demo --no-history --provider local --model offline-demo
```

Type `/` for the first view. Press Esc, remove `/`, then type `$` for the
second. Press Esc, remove `$`, then enter `/clear` for the third. Capture only
that terminal window with the operating system's screenshot tool. Do not
submit a model task or include private paths in a public image. Exit with
`/quit`. Remove only the workspace and home you created for the capture.

The main README uses these terminal captures only. The earlier logo image,
architecture illustration and fixture-based Learn preview are no longer
embedded there. Their source assets remain in the repository.

## Learn renderer fixture captures · 2026-11-08

These are real captures of [`learn-renderer.ts`](../../agent/neura/learn-renderer.ts)
on native Windows Microsoft Edge, using only the repository's
[synthetic booking fixture](../../scripts/learn-workshop-fixture.mjs). They contain
no private documents, workspace content, learner history, accounts or credentials.
No model request or real PDF import was made. The displayed `database-lecture.pdf`,
page 7 and all-`a` SHA-256 identifier are fictional fixture metadata.

| Asset | View and capture |
| --- | --- |
| [learn-workshop-desktop.png](learn-workshop-desktop.png) | Initial lesson; 1280 × 1000 viewport |
| [learn-sql-lab.png](learn-sql-lab.png) | SQL variant using `sqlExercise`; complete `#practice` panel |
| [learn-curriculum.png](learn-curriculum.png) | Complete `#curriculum` panel; rows → keys → joins, keys current, rows completed |

All captures use a 1280 × 1000 CSS-pixel desktop viewport at 1× scale. Panel captures
omit surrounding blank space; no UI, text, styles or pixels were retouched.
The accepted curriculum and completion statuses are supplied synthetic state, not
an actual learner's achievements. The lesson route is a lesson outline, distinct
from the prerequisite curriculum. Screenshots do not establish production readiness,
provider entitlement, accessibility certification or mastery.

The reproduction block checks desktop overflow, page errors and attempted external
requests while capturing the three views. The separate maintained browser verifier
checks 390-pixel layouts, exercise focus, revision-bound answer handoff, keyboard,
CSP and axe regressions. A screenshot alone is not evidence that those tests passed.

## Reproduce from this checkout

Use native PowerShell at the repository root with Node 24.15+, both locked dependency
graphs and installed Microsoft Edge. This uses existing `playwright-core`; no new
package, browser download, server or private Neura store is required.

```powershell
$env:NEURA_DOCS_OUTPUT = Join-Path $env:TEMP ("neura-docs-" + [guid]::NewGuid())
@'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { renderLearnHtml, renderLearnPathHtml } from './agent/neura/learn-renderer.ts';
import { workshopFixture, sqlExercise } from './scripts/learn-workshop-fixture.mjs';
const out = process.env.NEURA_DOCS_OUTPUT;
assert.ok(out, 'Set a fresh NEURA_DOCS_OUTPUT directory');
fs.mkdirSync(out);
const board = {
  path: {
    goal: "Query a customer's bookings with a JOIN", targetConceptId: 'joins',
    concepts: [{ id: 'rows', title: 'Rows and records' },
      { id: 'keys', title: 'Primary and foreign keys' },
      { id: 'joins', title: 'Join related records' }],
    edges: [{ from: 'rows', to: 'keys' }, { from: 'keys', to: 'joins' }],
  },
  current: 'keys', completed: ['rows'], accepted: true,
};
const views = [
  ['learn-workshop-desktop', renderLearnHtml(workshopFixture), null],
  ['learn-sql-lab', renderLearnHtml({ ...workshopFixture, id: 'booking-sql',
    title: 'Query related records', exercise: sqlExercise }), '#practice'],
  ['learn-curriculum', renderLearnPathHtml(board), '#curriculum'],
];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 },
    deviceScaleFactor: 1, offline: true, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [], network = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (!r.url().startsWith('file:')) network.push(r.url()); });
  for (const [name, html, selector] of views) {
    const file = path.join(out, name + '.html');
    fs.writeFileSync(file, html);
    await page.goto(pathToFileURL(file).href);
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.evaluate(() =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    if (selector) await page.locator(selector).evaluate(el => el.scrollIntoView({ block: 'start' }));
    await (selector ? page.locator(selector) : page).screenshot({ path: path.join(out, name + '.png') });
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(network, []);
  await context.close();
  console.log('Screenshots:', out);
} finally { await browser.close(); }
'@ | node --input-type=module
if ($LASTEXITCODE -ne 0) { throw 'Capture failed; do not promote artifacts.' }
Remove-Item Env:\NEURA_DOCS_OUTPUT
node scripts/verify-learn-browser.mjs
if ($LASTEXITCODE -ne 0) { throw 'Learn browser verification failed.' }
```

Inspect the three PNGs in the printed output directory before copying them here.
Keep fixture/state, captions and this provenance synchronized. Remove only your
own generated directory after review; never glob-delete other Neura temp stores.

## Historical images

`learn-workshop.png` and `plan-review.png` predate this documentation refresh and
remain for historical references. The Plan screenshot is not an implemented mode
in the current Mastra application. Neither is used to illustrate the current UI.
The old Pi renderer commands are not the current reproduction path.

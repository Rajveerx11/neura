# Screenshot provenance

## Current Mastra interface · 2026-11-08

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

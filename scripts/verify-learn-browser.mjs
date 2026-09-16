import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { renderLearnHtml, learnLessonRevision } from "../agent/neura/learn-renderer.ts";
import { workshopFixture, sqlExercise } from "./learn-workshop-fixture.mjs";
const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
async function captureScreenshot(page, screenshotPath) {
  let failure;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      return;
    } catch (error) {
      failure = error;
      if (attempt === 0) await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
    }
  }
  throw failure;
}
const output = process.env.NEURA_LEARN_BROWSER_OUTPUT
  ? resolve(process.env.NEURA_LEARN_BROWSER_OUTPUT)
  : mkdtempSync(join(tmpdir(), 'neura-learn-browser-'));
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.NEURA_BROWSER_CHANNEL || 'msedge', headless: true });
try {
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, offline: true, reducedMotion: 'reduce' });
    const page = await context.newPage(); const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (!request.url().startsWith('file:')) requests.push(request.url()); });
    const fixture = structuredClone(workshopFixture);
    fixture.references[0].excerpt += ' <img src="https://example.invalid/track" onerror="globalThis.pwned=true">';
    const filename = join(output, `learn-${width}.html`);
    writeFileSync(filename, renderLearnHtml(fixture));
    await page.goto(pathToFileURL(filename).href);
    await page.getByRole('button', { name: 'Customer', exact: true }).click();
    assert.equal(await page.locator('[data-node="customers"]').getAttribute('class'), 'diagram-node focused');
    await page.getByRole('button', { name: 'Let me try', exact: true }).click();
    assert.equal(await page.locator('input[name=answer]').first().evaluate(input => input === document.activeElement), true);
    await page.getByRole('radio').nth(1).check();
    await page.getByRole('button', { name: 'Check answer', exact: true }).click();
    assert.match(await page.locator('#feedback').innerText(), /does not fit/);
    await page.getByRole('button', { name: 'Give a hint', exact: true }).click();
    assert.equal(await page.locator('#hints li').count(), 1);
    await page.getByRole('button', { name: 'Next hint', exact: true }).click();
    assert.equal(await page.locator('#hints li').count(), 2);
    await page.getByRole('radio').first().check();
    await page.getByRole('button', { name: 'Check answer', exact: true }).click();
    assert.match(await page.locator('#feedback').innerText(), /Matches/);
    await page.getByRole('button', { name: 'Send attempt to Neura', exact: true }).click();
    assert.equal(await page.locator('#handoff-command').inputValue(), `/learn answer-helped-for ${learnLessonRevision(fixture)} 1`);
    await page.getByRole('button', { name: 'Reveal answer', exact: true }).click();
    assert.equal(await page.locator('#solution').isVisible(), true);
    assert.match(await page.locator('#feedback').innerText(), /revealed/);
    await page.getByRole('button', { name: 'Show example', exact: true }).click();
    assert.equal(await page.locator('#example').getAttribute('open'), '');
    await page.getByRole('button', { name: 'Go deeper in Neura', exact: true }).click();
    assert.equal(await page.locator('#handoff-command').inputValue(), `/learn deeper-for ${learnLessonRevision(fixture)}`);
    await page.getByRole('button', { name: 'Copy command', exact: true }).click();
    assert.match(await page.locator('#handoff-status').innerText(), /Copied|selected/);
    const layout = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, pwned: globalThis.pwned }));
    assert.ok(layout.scroll <= layout.width, `Page overflow at ${width}`); assert.equal(layout.pwned, undefined);
    await page.evaluate(() => { const script = document.createElement('script'); script.textContent = 'globalThis.cspBypassed=true'; document.body.append(script); });
    assert.equal(await page.evaluate(() => globalThis.cspBypassed), undefined, 'CSP must reject scripts without the fixed renderer hash');
    await page.locator('#sources summary').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'Source identity must wrap on narrow screens');
    const focus = page.getByRole('button', { name: 'Show example', exact: true });
    await focus.focus(); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Explain differently in Neura');
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineWidth);
    assert.ok(parseFloat(outline) >= 3);
    // Browser automation evaluates axe directly; CSP remains enabled for page scripts/resources.
    await page.evaluate(axeSource);
    const a11y = await page.evaluate(async () => globalThis.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } }));
    assert.deepEqual(a11y.violations.map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => node.target) })), []);
    await captureScreenshot(page, join(output, `learn-${width}.png`));
    assert.deepEqual(errors, []); assert.deepEqual(requests, []);
    for (const kind of ['flow', 'sequence']) {
      const next = structuredClone(workshopFixture); next.diagram.kind = kind;
      next.exercise = kind === 'flow' ? { kind: 'short', prompt: 'What key connects tables?', acceptedAnswers: ['foreign key'], hints: ['It references another record.'], explanation: 'Foreign keys connect records.' } : sqlExercise;
      const file = join(output, `${kind}-${width}.html`); writeFileSync(file, renderLearnHtml(next));
      await page.goto(pathToFileURL(file).href);
      await page.locator('#answer').fill(kind === 'flow' ? 'FOREIGN  KEY' : sqlExercise.solution);
      await page.locator('#exercise-form button[type=submit]').click();
      if (kind === 'flow') assert.match(await page.locator('#feedback').innerText(), /Matches/);
      else assert.equal(await page.locator('#handoff-command').inputValue(), `/learn answer-for ${learnLessonRevision(next)} ${sqlExercise.solution}`);
      await captureScreenshot(page, join(output, `${kind}-${width}.png`));
    }
    const subjective = structuredClone(workshopFixture);
    subjective.exercise = { kind: 'short', prompt: 'Explain your design choice', acceptedAnswers: [], hints: ['Discuss the tradeoff.'], explanation: 'Several designs can work; compare their consequences.' };
    const subjectivePath = join(output, `subjective-${width}.html`); writeFileSync(subjectivePath, renderLearnHtml(subjective, { historical: true }));
    await page.goto(pathToFileURL(subjectivePath).href);
    await page.locator('#answer').fill('My reasoning'); await page.locator('#exercise-form button[type=submit]').click();
    assert.match(await page.locator('#feedback').innerText(), /does not grade/);
    assert.equal(await page.locator('header [role=note]').isVisible(), true);
    assert.deepEqual(errors, []); assert.deepEqual(requests, []);
    await context.close();
  }
} finally { await browser.close(); }
console.log(`Learn browser: desktop/mobile, keyboard, CSP, no network, axe, diagrams, hints/reveal, grading and terminal handoff passed. Artifacts: ${output}`);

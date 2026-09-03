import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");
const repoRoot = path.resolve(import.meta.dirname, "..");
const { renderPlanHtml } = await import(
  pathToFileURL(path.join(repoRoot, "agent", "neura", "plan-renderer.ts")).href
);

const outputRoot = process.env.NEURA_A11Y_OUTPUT
  ? path.resolve(process.env.NEURA_A11Y_OUTPUT)
  : fs.mkdtempSync(path.join(os.tmpdir(), "neura-plan-accessibility-"));
fs.mkdirSync(outputRoot, { recursive: true });

const fixture = {
  slug: "accessibility-check",
  title: "Accessible Neura plan review",
  brief: "Verify that every generated plan remains readable, navigable, and usable across keyboard and narrow-screen workflows.",
  current: "Plan artifacts have strong visual structure but need automated browser accessibility evidence.",
  target: "Plan artifacts expose complete navigation, semantic evidence, visible focus, and responsive layouts.",
  done: "Automated browser checks pass at mobile and desktop widths without serious accessibility violations.",
  evidence: [
    { source: "Issue #37", finding: "Tables need captions and scoped headers; every rendered section needs navigation." },
    { source: "WCAG 2.2 AA", finding: "Small text, keyboard focus, and target sizing need measurable browser evidence." },
  ],
  preview: {
    title: "Accessible review surface",
    regions: [
      { title: "Navigate", tone: "accent", items: ["Every section listed", "Continuous numbering"] },
      { title: "Inspect", tone: "neutral", items: ["Semantic evidence", "Readable contrast"] },
      { title: "Decide", tone: "success", items: ["Visible focus", "Clear approval gate"] },
    ],
  },
  visuals: [{
    kind: "flow",
    title: "Review path",
    groups: [
      { title: "Open", items: ["Load local artifact"] },
      { title: "Navigate", tone: "accent", items: ["Use keyboard links"] },
      { title: "Approve", tone: "success", items: ["Confirm direction"] },
    ],
  }],
  steps: [
    { title: "Render semantics", what: "Generate complete landmarks and labels.", why: "Assistive technology needs explicit structure.", files: ["agent/neura/plan-renderer.ts"], proof: "Browser accessibility scan passes." },
    { title: "Verify layouts", what: "Exercise mobile and desktop viewports.", why: "Responsive defects appear only after browser layout.", files: ["scripts/verify-plan-accessibility.mjs"], proof: "Screenshots have no page overflow." },
  ],
  included: ["Keyboard navigation", "Responsive plan HTML"],
  deferred: ["Interactive editing", "Hosted artifacts"],
  risks: [{ risk: "Navigation can omit optional sections.", mitigation: "Derive links and numbering from one ordered section definition." }],
  verification: ["Run the real-browser accessibility suite.", "Inspect narrow and desktop screenshots."],
  decisions: [{ decision: "Token source", direction: "Use the same semantic palette as the terminal UI." }],
  openQuestions: ["Is the implementation ready for human approval?"],
  sources: [{ label: "W3C WCAG 2.2", note: "Accessibility success criteria used by the automated checks.", url: "https://www.w3.org/TR/WCAG22/" }],
};

const htmlPath = path.join(outputRoot, "plan-accessibility.html");
fs.writeFileSync(htmlPath, renderPlanHtml(fixture), "utf-8");

const viewports = [
  { name: "narrow", width: 375, height: 812 },
  { name: "desktop", width: 1280, height: 900 },
];
const results = [];
let browser;

try {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      bypassCSP: true,
      colorScheme: "dark",
      offline: true,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const pageErrors = [];
    const failedRequests = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()}`));

    try {
      await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
      const screenshotPath = path.join(outputRoot, `plan-${viewport.width}x${viewport.height}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });

      const layout = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        sections: [...document.querySelectorAll("main > section")].map((section) => section.id),
        navigation: [...document.querySelectorAll('nav[aria-label="Plan sections"] a')]
          .map((link) => link.getAttribute("href")?.slice(1)),
      }));
      assert.ok(layout.scrollWidth <= layout.clientWidth, `${viewport.name} plan overflows horizontally`);
      assert.deepEqual(layout.navigation, layout.sections, `${viewport.name} navigation and rendered sections differ`);

      const navTargets = await page.locator('nav[aria-label="Plan sections"] a').evaluateAll((links) =>
        links.map((link) => link.getBoundingClientRect().height));
      assert.ok(navTargets.every((height) => height >= 44), `${viewport.name} navigation target is below 44 CSS pixels`);

      const sourceTargets = await page.locator(".sources a").evaluateAll((links) =>
        links.map((link) => link.getBoundingClientRect().height));
      assert.ok(sourceTargets.every((height) => height >= 44), `${viewport.name} source target is below 44 CSS pixels`);

      const firstLink = page.getByRole("navigation", { name: "Plan sections" }).getByRole("link").first();
      await firstLink.focus();
      const focusStyle = await firstLink.evaluate((link) => {
        const style = getComputedStyle(link);
        return { width: Number.parseFloat(style.outlineWidth), style: style.outlineStyle };
      });
      assert.ok(focusStyle.width >= 3 && focusStyle.style !== "none", `${viewport.name} keyboard focus is not visibly outlined`);

      await page.addScriptTag({ path: axePath });
      const accessibility = await page.evaluate(async () => globalThis.axe.run(document, {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
        },
      }));
      const violations = accessibility.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        targets: violation.nodes.flatMap((node) => node.target),
      }));
      assert.deepEqual(violations, [], `${viewport.name} accessibility violations: ${JSON.stringify(violations)}`);
      assert.deepEqual(pageErrors, [], `${viewport.name} page errors: ${pageErrors.join("; ")}`);
      assert.deepEqual(failedRequests, [], `${viewport.name} request failures: ${failedRequests.join("; ")}`);
      results.push({ viewport, screenshotPath, sections: layout.sections.length, violations: 0 });
    } finally {
      await context.close();
    }
  }
} finally {
  await browser?.close();
}

fs.writeFileSync(path.join(outputRoot, "results.json"), `${JSON.stringify(results, null, 2)}\n`, "utf-8");
console.log(`Neura plan accessibility: ${results.length} viewports passed; artifacts: ${outputRoot}`);

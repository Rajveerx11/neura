import { isSafeExternalUrl, isSafePlanSlug } from "./plan-policy.ts";

export type PlanTone = "neutral" | "accent" | "success" | "warning" | "risk";
export type PlanVisualKind = "flow" | "comparison" | "boundary";

export type PlanVisualGroup = {
  title: string;
  detail?: string;
  tone?: PlanTone;
  items: string[];
};

export type PlanVisual = {
  kind: PlanVisualKind;
  title: string;
  caption?: string;
  groups: PlanVisualGroup[];
};

export type PlanPreview = {
  title: string;
  caption?: string;
  regions: PlanVisualGroup[];
};

export type PlanStep = {
  title: string;
  what: string;
  why: string;
  files: string[];
  proof: string;
};

export type PlanDocument = {
  slug: string;
  title: string;
  brief: string;
  current: string;
  target: string;
  done: string;
  evidence: Array<{ source: string; finding: string }>;
  preview?: PlanPreview;
  visuals: PlanVisual[];
  steps: PlanStep[];
  included: string[];
  deferred: string[];
  risks: Array<{ risk: string; mitigation: string }>;
  verification: string[];
  decisions?: Array<{ decision: string; direction: string }>;
  openQuestions?: string[];
  sources: Array<{ label: string; note: string; url?: string }>;
};

const TONES = new Set<PlanTone>(["neutral", "accent", "success", "warning", "risk"]);
const VISUAL_KINDS = new Set<PlanVisualKind>(["flow", "comparison", "boundary"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function requireText(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== "string" || value.trim().length < min || value.length > max) {
    throw new Error(`${label} must contain ${min}-${max} characters.`);
  }
  return value.trim();
}

function requireArray(value: unknown, label: string, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new Error(`${label} must contain ${min}-${max} items.`);
  }
  return value;
}

function requireTextArray(value: unknown, label: string, min: number, max: number, itemMax = 300): string[] {
  return requireArray(value, label, min, max).map((item, index) => requireText(item, `${label}[${index}]`, 1, itemMax));
}

export function assertPlanDocument(value: unknown): asserts value is PlanDocument {
  if (!isRecord(value)) throw new Error("Plan input must be an object.");
  if (!isSafePlanSlug(value.slug)) throw new Error("slug must use 2-80 lowercase letters, numbers, and single hyphens.");
  requireText(value.title, "title", 4, 160);
  requireText(value.brief, "brief", 20, 600);
  requireText(value.current, "current", 10, 500);
  requireText(value.target, "target", 10, 500);
  requireText(value.done, "done", 10, 500);

  requireArray(value.evidence, "evidence", 1, 12).forEach((item, index) => {
    if (!isRecord(item)) throw new Error(`evidence[${index}] must be an object.`);
    requireText(item.source, `evidence[${index}].source`, 1, 240);
    requireText(item.finding, `evidence[${index}].finding`, 5, 500);
  });

  if (value.preview !== undefined) {
    if (!isRecord(value.preview)) throw new Error("preview must be an object.");
    requireText(value.preview.title, "preview.title", 3, 120);
    if (value.preview.caption !== undefined) requireText(value.preview.caption, "preview.caption", 3, 300);
    requireArray(value.preview.regions, "preview.regions", 1, 8).forEach((region, regionIndex) => {
      if (!isRecord(region)) throw new Error(`preview.regions[${regionIndex}] must be an object.`);
      requireText(region.title, `preview.regions[${regionIndex}].title`, 1, 100);
      if (region.detail !== undefined) requireText(region.detail, `preview.regions[${regionIndex}].detail`, 1, 240);
      if (region.tone !== undefined && !TONES.has(region.tone as PlanTone)) throw new Error(`preview.regions[${regionIndex}].tone is invalid.`);
      requireTextArray(region.items, `preview.regions[${regionIndex}].items`, 1, 8, 220);
    });
  }

  requireArray(value.visuals, "visuals", 1, 3).forEach((item, index) => {
    if (!isRecord(item) || !VISUAL_KINDS.has(item.kind as PlanVisualKind)) throw new Error(`visuals[${index}].kind is invalid.`);
    requireText(item.title, `visuals[${index}].title`, 3, 120);
    if (item.caption !== undefined) requireText(item.caption, `visuals[${index}].caption`, 3, 300);
    const groups = requireArray(item.groups, `visuals[${index}].groups`, 2, 8);
    if (item.kind === "comparison" && groups.length !== 2) throw new Error("Comparison visuals require exactly two groups.");
    if (item.kind === "boundary" && groups.length > 4) throw new Error("Boundary visuals support at most four groups.");
    groups.forEach((group, groupIndex) => {
      if (!isRecord(group)) throw new Error(`visuals[${index}].groups[${groupIndex}] must be an object.`);
      requireText(group.title, `visuals[${index}].groups[${groupIndex}].title`, 1, 100);
      if (group.detail !== undefined) requireText(group.detail, `visuals[${index}].groups[${groupIndex}].detail`, 1, 240);
      if (group.tone !== undefined && !TONES.has(group.tone as PlanTone)) throw new Error(`visuals[${index}].groups[${groupIndex}].tone is invalid.`);
      requireTextArray(group.items, `visuals[${index}].groups[${groupIndex}].items`, 1, 8, 220);
    });
  });

  requireArray(value.steps, "steps", 2, 8).forEach((item, index) => {
    if (!isRecord(item)) throw new Error(`steps[${index}] must be an object.`);
    requireText(item.title, `steps[${index}].title`, 2, 120);
    requireText(item.what, `steps[${index}].what`, 5, 500);
    requireText(item.why, `steps[${index}].why`, 5, 400);
    requireTextArray(item.files, `steps[${index}].files`, 1, 8, 240);
    requireText(item.proof, `steps[${index}].proof`, 5, 400);
  });

  requireTextArray(value.included, "included", 1, 12);
  requireTextArray(value.deferred, "deferred", 1, 12);
  requireArray(value.risks, "risks", 1, 10).forEach((item, index) => {
    if (!isRecord(item)) throw new Error(`risks[${index}] must be an object.`);
    requireText(item.risk, `risks[${index}].risk`, 3, 300);
    requireText(item.mitigation, `risks[${index}].mitigation`, 3, 400);
  });
  requireTextArray(value.verification, "verification", 2, 12, 400);

  if (value.decisions !== undefined) requireArray(value.decisions, "decisions", 1, 10).forEach((item, index) => {
    if (!isRecord(item)) throw new Error(`decisions[${index}] must be an object.`);
    requireText(item.decision, `decisions[${index}].decision`, 2, 180);
    requireText(item.direction, `decisions[${index}].direction`, 3, 500);
  });
  if (value.openQuestions !== undefined) requireTextArray(value.openQuestions, "openQuestions", 1, 6, 400);
  requireArray(value.sources, "sources", 1, 12).forEach((item, index) => {
    if (!isRecord(item)) throw new Error(`sources[${index}] must be an object.`);
    requireText(item.label, `sources[${index}].label`, 2, 240);
    requireText(item.note, `sources[${index}].note`, 3, 500);
    if (item.url !== undefined) requireText(item.url, `sources[${index}].url`, 8, 2_048);
  });
}

export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderItems(items: string[]): string {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderPreview(preview: PlanPreview): string {
  const regions = preview.regions.map((region, index) => {
    const tone = TONES.has(region.tone ?? "neutral") ? region.tone ?? "neutral" : "neutral";
    return `<article class="preview-region tone-${tone}">
      <span class="preview-index">Region ${String(index + 1).padStart(2, "0")}</span>
      <h3>${escapeHtml(region.title)}</h3>
      ${region.detail ? `<p>${escapeHtml(region.detail)}</p>` : ""}
      <div class="preview-lines">${region.items.map((item) => `<div>${escapeHtml(item)}</div>`).join("")}</div>
    </article>`;
  }).join("");
  return `<section id="preview" class="preview-section"><header><span>Proposed state</span><div><h2>${escapeHtml(preview.title)}</h2><p>${escapeHtml(preview.caption ?? "Directional preview for review before implementation.")}</p></div></header>
    <div class="future-preview" role="group" aria-label="${escapeHtml(preview.title)}">${regions}</div>
  </section>`;
}

function renderVisual(visual: PlanVisual, index: number): string {
  const groups = visual.groups.map((group, groupIndex) => {
    const tone = TONES.has(group.tone ?? "neutral") ? group.tone ?? "neutral" : "neutral";
    return `<article class="visual-group tone-${tone}">
      <span class="visual-index">${String(groupIndex + 1).padStart(2, "0")}</span>
      <h3>${escapeHtml(group.title)}</h3>
      ${group.detail ? `<p>${escapeHtml(group.detail)}</p>` : ""}
      ${renderItems(group.items)}
    </article>`;
  }).join(visual.kind === "flow" ? '<div class="flow-link" aria-hidden="true">&gt;</div>' : "");
  return `<figure class="visual visual-${escapeHtml(visual.kind)}" aria-labelledby="visual-${index}-title">
    <figcaption><span>Visual ${String(index + 1).padStart(2, "0")}</span><strong id="visual-${index}-title">${escapeHtml(visual.title)}</strong></figcaption>
    <div class="visual-grid">${groups}</div>
    ${visual.caption ? `<p class="visual-caption">${escapeHtml(visual.caption)}</p>` : ""}
  </figure>`;
}

function renderSources(sources: PlanDocument["sources"]): string {
  return sources.map((source) => {
    const label = escapeHtml(source.label);
    const linkedLabel = source.url && isSafeExternalUrl(source.url)
      ? `<a href="${escapeHtml(source.url)}" rel="noreferrer">${label}</a>`
      : `<strong>${label}</strong>`;
    return `<li>${linkedLabel}<span>${escapeHtml(source.note)}</span></li>`;
  }).join("");
}

export function renderPlanHtml(plan: PlanDocument): string {
  assertPlanDocument(plan);
  const created = new Date().toISOString().slice(0, 10);
  const decisions = plan.decisions?.length ? `<section id="decisions">
    <header><span>06 / Decisions</span><div><h2>Decisions</h2><p>Chosen directions that shape implementation.</p></div></header>
    <div class="decision-list">${plan.decisions.map((item) => `<article><strong>${escapeHtml(item.decision)}</strong><p>${escapeHtml(item.direction)}</p></article>`).join("")}</div>
  </section>` : "";
  const questions = plan.openQuestions?.length ? `<section id="questions">
    <header><span>Open questions</span><div><h2>Human decisions</h2><p>Only choices that materially change scope or architecture appear here.</p></div></header>
    <ol class="questions">${plan.openQuestions.map((question) => `<li>${escapeHtml(question)}</li>`).join("")}</ol>
  </section>` : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'" />
  <meta name="referrer" content="no-referrer" />
  <title>${escapeHtml(plan.title)}</title>
  <style>
    :root{--page:#0b0c0e;--surface:#14171a;--raised:#1c2024;--line:#2c3237;--strong:#485159;--text:#e8e2d8;--soft:#cbc5bb;--muted:#a8a39b;--dim:#74787b;--copper:#d97841;--plan:#76b8c4;--success:#69c08a;--warning:#d3a64a;--error:#df6b63;--mono:"Cascadia Mono",Consolas,monospace;--sans:"Segoe UI Variable","Segoe UI",system-ui,sans-serif;--content:1160px}
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;overflow-x:hidden;background:var(--page);color:var(--text);font:16px/1.62 var(--sans);text-rendering:optimizeLegibility}a{color:var(--plan);text-underline-offset:3px}code{color:#efa476;font-family:var(--mono)}
    .topbar{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:20px;min-height:52px;padding:0 22px;border-bottom:1px solid var(--line);background:rgba(11,12,14,.95);backdrop-filter:blur(8px)}.brand,.date,.eyebrow,section>header>span,.visual-index,.step-number{font-family:var(--mono);text-transform:uppercase;letter-spacing:.11em}.brand{color:var(--copper);font-size:12px;font-weight:700}.date{color:var(--dim);font-size:10px}nav{display:flex;min-width:0;max-width:100%;gap:16px;overflow-x:auto}nav a{color:var(--muted);font-size:12px;text-decoration:none;white-space:nowrap}
    main{width:min(calc(100% - 36px),var(--content));margin:0 auto;padding:50px 0 82px}.hero{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(260px,.65fr);gap:44px;align-items:end;padding:10px 0 44px;border-bottom:1px solid var(--strong)}.eyebrow{margin:0 0 12px;color:var(--copper);font-size:11px;font-weight:700}h1,h2,h3{margin:0;line-height:1.16}h1{max-width:800px;font-size:clamp(34px,5vw,58px);font-weight:610;letter-spacing:-.04em;overflow-wrap:anywhere}h2{font-size:clamp(25px,3vw,35px);letter-spacing:-.025em}h3{font-size:16px}.brief{max-width:760px;margin:20px 0 0;color:var(--soft);font-size:19px}.gate{padding:5px 0 5px 18px;border-left:2px solid var(--copper)}.gate small{color:var(--dim);font:700 10px/1.2 var(--mono);letter-spacing:.1em;text-transform:uppercase}.gate strong{display:block;margin-top:9px;font-size:18px}.gate p{margin:7px 0 0;color:var(--muted);font-size:13px}
    section{padding:56px 0;border-bottom:1px solid var(--line);scroll-margin-top:64px}section>header{display:grid;grid-template-columns:160px minmax(0,1fr);gap:28px;margin-bottom:28px}section>header>span{color:var(--copper);font-size:10px;font-weight:700}section>header p{max-width:740px;margin:8px 0 0;color:var(--muted)}
    .status-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;border:1px solid var(--line);background:var(--line)}.status-card{padding:22px;background:var(--page)}.status-card:nth-child(2){background:var(--surface)}.status-card span{display:block;margin-bottom:15px;color:var(--plan);font:700 10px/1.2 var(--mono);letter-spacing:.1em;text-transform:uppercase}.status-card p{margin:8px 0 0;color:var(--muted);font-size:14px}
    .evidence{width:100%;table-layout:fixed;border-collapse:collapse}.evidence th,.evidence td{padding:14px 12px;border-top:1px solid var(--line);text-align:left;vertical-align:top;overflow-wrap:anywhere}.evidence th{color:var(--dim);font:700 10px/1.2 var(--mono);letter-spacing:.1em;text-transform:uppercase}.evidence td{color:var(--soft);font-size:14px}.evidence td:first-child{width:34%;color:var(--text);font-family:var(--mono);font-size:13px}
    .future-preview{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1px;padding:1px;border:1px solid var(--strong);background:var(--line)}.preview-region{min-width:0;padding:20px;background:var(--page)}.preview-region.tone-accent{box-shadow:inset 3px 0 0 var(--copper)}.preview-region.tone-success{box-shadow:inset 3px 0 0 var(--success)}.preview-region.tone-warning{box-shadow:inset 3px 0 0 var(--warning)}.preview-region.tone-risk{box-shadow:inset 3px 0 0 var(--error)}.preview-index{display:block;margin-bottom:12px;color:var(--copper);font:700 9px/1.2 var(--mono);letter-spacing:.1em;text-transform:uppercase}.preview-region p{margin:7px 0 0;color:var(--muted);font-size:13px}.preview-lines{display:grid;gap:7px;margin-top:15px}.preview-lines div{padding:8px 10px;border-left:1px solid var(--strong);background:var(--surface);color:var(--soft);font:12px/1.45 var(--mono);overflow-wrap:anywhere}
    .visual{margin:28px 0 0;padding:20px;border:1px solid var(--strong);background:var(--surface)}.visual figcaption{display:flex;align-items:baseline;gap:16px;margin-bottom:18px}.visual figcaption span{color:var(--plan);font:700 10px/1.2 var(--mono);letter-spacing:.1em;text-transform:uppercase}.visual figcaption strong{font-size:17px}.visual-grid{display:grid;gap:12px}.visual-flow .visual-grid{display:flex;align-items:stretch;gap:8px;overflow-x:auto}.visual-flow .visual-group{flex:1 0 150px}.visual-comparison .visual-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.visual-boundary .visual-grid{grid-template-columns:repeat(auto-fit,minmax(190px,1fr))}.visual-group{min-width:0;padding:16px;border:1px solid var(--line);background:var(--page)}.visual-group.tone-accent{border-color:var(--plan);background:#12252a}.visual-group.tone-success{border-color:var(--success)}.visual-group.tone-warning{border-color:var(--warning)}.visual-group.tone-risk{border-color:var(--error)}.visual-index{display:block;margin-bottom:12px;color:var(--dim);font-size:9px}.visual-group p{margin:7px 0 0;color:var(--muted);font-size:13px}.visual-group ul{margin:13px 0 0;padding-left:18px}.visual-group li{margin:6px 0;color:var(--soft);font-size:13px}.flow-link{display:grid;place-items:center;flex:0 0 14px;color:var(--copper);font:700 14px/1 var(--mono)}.visual-caption{margin:16px 0 0;color:var(--muted);font-size:13px;text-align:center}
    .steps{display:grid}.step{display:grid;grid-template-columns:68px minmax(0,1fr) minmax(230px,.45fr);gap:20px;padding:22px 0;border-top:1px solid var(--line)}.step-number{color:var(--copper);font-size:10px}.step p{margin:7px 0 0;color:var(--muted)}.files{margin:12px 0 0;padding:0;list-style:none}.files li{color:var(--soft);font:12px/1.6 var(--mono);overflow-wrap:anywhere}.proof{color:var(--soft);font-size:13px}.proof b{display:block;margin-bottom:6px;color:var(--plan);font:700 10px/1.2 var(--mono);letter-spacing:.1em;text-transform:uppercase}
    .two-column{display:grid;grid-template-columns:1fr 1fr;gap:24px}.panel{padding:20px;border-top:1px solid var(--strong)}.panel h3{margin-bottom:12px}.panel ul,.checklist,.questions{margin:0;padding-left:20px}.panel li,.questions li{margin:8px 0;color:var(--soft)}.risk-list,.decision-list{display:grid;gap:1px;border:1px solid var(--line);background:var(--line)}.risk-list article,.decision-list article{display:grid;grid-template-columns:.7fr 1.3fr;gap:20px;padding:16px 18px;background:var(--page)}.risk-list p,.decision-list p{margin:0;color:var(--muted)}.checklist{display:grid;grid-template-columns:1fr 1fr;gap:0 28px;padding:0;list-style:none}.checklist li{position:relative;padding:13px 0 13px 28px;border-top:1px solid var(--line);color:var(--soft)}.checklist li:before{content:"[ ]";position:absolute;left:0;color:var(--success);font:12px/1.7 var(--mono)}
    .sources{margin:0;padding-left:22px}.sources li{margin:11px 0;color:var(--muted)}.sources li span{display:block;color:var(--soft)}.approval{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:26px;align-items:center;padding:26px;border:1px solid var(--copper);background:#2a1b14}.approval p{margin:8px 0 0;color:var(--soft)}.approval-state{padding:10px 14px;border:1px solid var(--copper);color:var(--copper);font:700 10px/1.2 var(--mono);letter-spacing:.1em;text-transform:uppercase}footer{padding-top:30px;color:var(--dim);font:11px/1.6 var(--mono)}
    @media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
    @media(max-width:900px){.hero,section>header,.two-column{grid-template-columns:1fr}.status-grid{grid-template-columns:1fr}.step{grid-template-columns:52px 1fr}.proof{grid-column:2}}
    @media(max-width:620px){*{min-width:0}.topbar{align-items:flex-start;flex-direction:column;max-width:100vw;gap:9px;overflow:hidden;padding:14px 18px}nav{width:100%}.date{display:none}main{width:auto;max-width:none;margin:0 14px;padding-top:34px}h1{font-size:30px}h1,h2,h3,p,li,td{overflow-wrap:break-word}.future-preview{grid-template-columns:1fr}.visual-flow .visual-grid{flex-direction:column;overflow:visible}.visual-flow .visual-group{flex-basis:auto}.flow-link{min-height:18px;transform:rotate(90deg)}.visual-comparison .visual-grid,.visual-boundary .visual-grid{grid-template-columns:1fr}.step{grid-template-columns:1fr}.proof{grid-column:1}.risk-list article,.decision-list article{grid-template-columns:1fr}.checklist{grid-template-columns:1fr}.approval{grid-template-columns:1fr}.evidence th,.evidence td{padding:11px 8px}.evidence td:first-child{width:42%;font-size:11px}}
  </style>
</head>
<body>
  <header class="topbar">
    <div class="brand">Neura / Plan</div>
    <nav aria-label="Plan sections">${plan.preview ? '<a href="#preview">Preview</a>' : ""}<a href="#summary">Summary</a><a href="#evidence">Evidence</a><a href="#visuals">Visuals</a><a href="#steps">Steps</a><a href="#verification">Proof</a><a href="#approval">Approval</a></nav>
    <div class="date">${escapeHtml(created)}</div>
  </header>
  <main>
    <header class="hero">
      <div><p class="eyebrow">Implementation plan</p><h1>${escapeHtml(plan.title)}</h1><p class="brief">${escapeHtml(plan.brief)}</p></div>
      <aside class="gate"><small>Plan boundary</small><strong>Research complete</strong><p>Review this artifact. Implementation waits for approval.</p></aside>
    </header>

    ${plan.preview ? renderPreview(plan.preview) : ""}

    <section id="summary"><header><span>01 / Summary</span><div><h2>Now, target, done</h2><p>Fast orientation before implementation detail.</p></div></header>
      <div class="status-grid"><article class="status-card"><span>Now</span><h3>Current state</h3><p>${escapeHtml(plan.current)}</p></article><article class="status-card"><span>Target</span><h3>Planned state</h3><p>${escapeHtml(plan.target)}</p></article><article class="status-card"><span>Done</span><h3>Success condition</h3><p>${escapeHtml(plan.done)}</p></article></div>
    </section>

    <section id="evidence"><header><span>02 / Evidence</span><div><h2>What research found</h2><p>Code, documentation, and external facts that shaped this direction.</p></div></header>
      <table class="evidence"><thead><tr><th>Source</th><th>Finding</th></tr></thead><tbody>${plan.evidence.map((item) => `<tr><td>${escapeHtml(item.source)}</td><td>${escapeHtml(item.finding)}</td></tr>`).join("")}</tbody></table>
    </section>

    <section id="visuals"><header><span>03 / Visuals</span><div><h2>How the change works</h2><p>${plan.preview ? "Visuals explain sequence, comparison, or ownership boundaries. The proposed-state preview above shows how visible outcomes may look." : "Visuals explain sequence, comparison, or ownership boundaries."}</p></div></header>${plan.visuals.map(renderVisual).join("")}</section>

    <section id="steps"><header><span>04 / Steps</span><div><h2>Implementation path</h2><p>Each step states the change, reason, files, and proof.</p></div></header>
      <div class="steps">${plan.steps.map((step, index) => `<article class="step"><div class="step-number">Step ${String(index + 1).padStart(2, "0")}</div><div><h3>${escapeHtml(step.title)}</h3><p>${escapeHtml(step.what)}</p><p><strong>Why:</strong> ${escapeHtml(step.why)}</p><ul class="files">${step.files.map((file) => `<li>${escapeHtml(file)}</li>`).join("")}</ul></div><div class="proof"><b>Proof</b>${escapeHtml(step.proof)}</div></article>`).join("")}</div>
    </section>

    <section id="scope"><header><span>05 / Scope</span><div><h2>Boundaries and risks</h2><p>What ships now, what waits, and what could go wrong.</p></div></header>
      <div class="two-column"><article class="panel"><h3>Included</h3>${renderItems(plan.included)}</article><article class="panel"><h3>Deferred</h3>${renderItems(plan.deferred)}</article></div>
      <div class="risk-list">${plan.risks.map((item) => `<article><strong>${escapeHtml(item.risk)}</strong><p>${escapeHtml(item.mitigation)}</p></article>`).join("")}</div>
    </section>

    ${decisions}

    <section id="verification"><header><span>07 / Verification</span><div><h2>How success is proven</h2><p>Checks include the real human workflow, not only unit tests.</p></div></header><ul class="checklist">${plan.verification.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>

    ${questions}

    <section id="sources"><header><span>08 / Sources</span><div><h2>Research trail</h2><p>Only sources that materially informed the plan.</p></div></header><ol class="sources">${renderSources(plan.sources)}</ol></section>

    <section id="approval" style="border-bottom:0"><div class="approval"><div><h2>Approval gate</h2><p>Approve this direction or request changes. Neura must not implement while Plan mode remains active.</p></div><div class="approval-state">Awaiting review</div></div></section>
    <footer>Local artifact · project plans/ folder · generated by Neura Plan mode</footer>
  </main>
</body>
</html>`;
}

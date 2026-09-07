import { createHash } from "node:crypto";
import { PALETTE } from "./ui-tokens.ts";
import { assertLearnExercise, learnArray, learnText, type LearnExercise } from "./learn-exercises.ts";

export type LearnReference = { sourceId: string; filename: string; unit: "page" | "slide"; number: number; excerpt: string };
export type LearnDiagram = {
  kind: "flow" | "er" | "sequence"; title: string;
  nodes: { id: string; label: string; detail?: string; fields?: string[] }[];
  edges: { from: string; to: string; label: string }[]; focus?: string;
};
export type LearnLesson = {
  id: string; title: string; goal: string; steps: string[]; currentStep: number;
  bullets: string[]; example: string; diagram: LearnDiagram; references: LearnReference[]; exercise: LearnExercise;
};
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function assertLearnLesson(value: unknown): asserts value is LearnLesson {
  if (!isRecord(value)) throw new Error("Lesson must be an object.");
  if (typeof value.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id) || value.id.length > 80) throw new Error("Lesson id must be 1-80 lowercase letters, digits and single hyphens.");
  learnText(value.title, "lesson.title", 160); learnText(value.goal, "lesson.goal", 500);
  learnArray(value.steps, "lesson.steps", 1, 5); value.steps.forEach((step) => learnText(step, "step", 120));
  if (!Number.isInteger(value.currentStep) || Number(value.currentStep) < 0 || Number(value.currentStep) >= value.steps.length) throw new Error("currentStep must be a zero-based step index.");
  learnArray(value.bullets, "lesson.bullets", 3, 5); value.bullets.forEach((bullet) => learnText(bullet, "bullet", 300));
  learnText(value.example, "lesson.example", 3000);
  const diagram = value.diagram;
  if (!isRecord(diagram) || !["flow", "er", "sequence"].includes(String(diagram.kind))) throw new Error("Diagram kind must be flow, er or sequence.");
  learnText(diagram.title, "diagram.title", 160);
  learnArray(diagram.nodes, "diagram.nodes", 2, 6);
  const ids = new Set<string>();
  for (const node of diagram.nodes) {
    if (!isRecord(node) || typeof node.id !== "string" || !/^[a-z][a-z0-9-]{0,39}$/.test(node.id) || ids.has(node.id)) throw new Error("Diagram nodes require unique simple ids.");
    ids.add(node.id); learnText(node.label, "node.label", 50);
    if (node.detail !== undefined) learnText(node.detail, "node.detail", 240);
    if (node.fields !== undefined) { learnArray(node.fields, "node.fields", 1, 6); node.fields.forEach((field) => learnText(field, "field", 60)); }
  }
  learnArray(diagram.edges, "diagram.edges", 1, 12);
  for (const edge of diagram.edges) {
    if (!isRecord(edge) || !ids.has(String(edge.from)) || !ids.has(String(edge.to)) || edge.from === edge.to) throw new Error("Diagram edges must connect two different existing nodes.");
    learnText(edge.label, "edge.label", 80);
  }
  if (diagram.focus !== undefined && !ids.has(String(diagram.focus))) throw new Error("Diagram focus must name an existing node.");
  learnArray(value.references, "lesson.references", 0, 12);
  for (const reference of value.references) {
    if (!isRecord(reference) || typeof reference.sourceId !== "string" || !/^sha256:[a-f0-9]{64}$/.test(reference.sourceId) || !["page", "slide"].includes(String(reference.unit)) || !Number.isInteger(reference.number) || Number(reference.number) < 1 || Number(reference.number) > 10000) throw new Error("References require a SHA256 source identity and a valid page or slide.");
    learnText(reference.filename, "reference.filename", 240); learnText(reference.excerpt, "reference.excerpt", 2000);
  }
  assertLearnExercise(value.exercise);
  if (JSON.stringify(value).length > 320_000) throw new Error("Lesson exceeds the 320 KB size limit.");
}
const escapeHtml = (value: unknown): string => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
function lines(value: string, width: number): string[] {
  // Fixed-width SVG text uses bounded lines. Full text is always in the text alternative.
  const words = value.match(new RegExp(`.{1,${width}}(?:\\s|$)|.{1,${width}}`, "gu")) ?? [value];
  return words.map((word) => word.trim());
}
function svgText(value: string, x: number, y: number, width = 24, className = "node-label"): string {
  return `<text class="${className}" x="${x}" y="${y}">${lines(value, width).map((line, index) => `<tspan x="${x}" dy="${index ? 20 : 0}">${escapeHtml(line)}</tspan>`).join("")}</text>`;
}
function renderDiagram(diagram: LearnDiagram): string {
  const { nodes, edges } = diagram;
  const width = Math.max(640, nodes.length * 220);
  const sequence = diagram.kind === "sequence";
  const headerHeight = Math.max(...nodes.map((node) => lines(node.label, 22).length)) * 20 + 34;
  const fieldHeight = Math.max(...nodes.map((node) => (node.fields ?? []).reduce((sum, field) => sum + lines(field, 24).length * 20 + 8, 0)));
  const cardHeight = diagram.kind === "er" ? headerHeight + fieldHeight + 24 : headerHeight + 12;
  const edgeGap = Math.max(80, ...edges.map((edge) => lines(edge.label, 20).length * 20 + 30));
  const height = cardHeight + 100 + edges.length * edgeGap;
  const centers = new Map(nodes.map((node, index) => [node.id, 110 + index * 220]));
  const edgeSvg = edges.map((edge, index) => {
    const from = centers.get(edge.from)!; const to = centers.get(edge.to)!;
    const y = cardHeight + 85 + index * edgeGap;
    const path = sequence ? `M ${from} ${y} H ${to}` : `M ${from} ${cardHeight + 32} V ${y} H ${to} V ${cardHeight + 32}`;
    const label = `${sequence ? `${index + 1}. ` : ""}${edge.label}`;
    const labelWidth = Math.max(20, Math.floor(Math.abs(to - from) / 8));
    const labelY = y - 12 - (lines(label, labelWidth).length - 1) * 20;
    return `<g class="diagram-edge" data-from="${edge.from}" data-to="${edge.to}"><path d="${path}" marker-end="url(#arrow)"/>${svgText(label, (from + to) / 2, labelY, labelWidth, "edge-label")}</g>`;
  }).join("");
  const nodeSvg = nodes.map((node) => {
    const center = centers.get(node.id)!;
    let fieldY = 32 + headerHeight;
    const fields = diagram.kind === "er" ? (node.fields ?? []).map((field) => { const rendered = svgText(field, center, fieldY, 24, "field-label"); fieldY += lines(field, 24).length * 20 + 8; return rendered; }).join("") : "";
    return `<g class="diagram-node${node.id === diagram.focus ? " focused" : ""}" data-node="${node.id}"><rect x="${center - 98}" y="32" width="196" height="${cardHeight}" rx="10"/>${svgText(node.label, center, 59, 22)}${fields}${sequence ? `<path class="lifeline" d="M ${center} ${cardHeight + 36} V ${height - 15}"/>` : ""}</g>`;
  }).join("");
  return `<div class="diagram-scroll" tabindex="0" role="region" aria-label="${escapeHtml(diagram.title)}; scroll horizontally for wide diagrams"><svg role="img" aria-labelledby="diagram-title diagram-description" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><title id="diagram-title">${escapeHtml(diagram.title)}</title><desc id="diagram-description">${escapeHtml(edges.map((edge) => `${nodes.find((node) => node.id === edge.from)!.label}: ${edge.label}: ${nodes.find((node) => node.id === edge.to)!.label}`).join(". "))}. Full details follow in the text alternative.</desc><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"/></marker></defs>${edgeSvg}${nodeSvg}</svg></div>
  <p class="muted diagram-tip">Wide diagram? Scroll sideways, or open the text version below.</p><div class="focus-controls" role="group" aria-label="Highlight a concept">${nodes.map((node) => `<button type="button" class="quiet" data-focus="${node.id}" aria-pressed="${node.id === diagram.focus}">${escapeHtml(node.label)}</button>`).join("")}</div><p id="focus-description" aria-live="polite">${escapeHtml(nodes.find((node) => node.id === diagram.focus)?.detail ?? "Select a concept to highlight its connections.")}</p>
  <details><summary>Diagram as text</summary><ul>${nodes.map((node) => `<li><strong>${escapeHtml(node.label)}</strong>${node.detail ? `: ${escapeHtml(node.detail)}` : ""}${node.fields ? `<ul>${node.fields.map((field) => `<li>${escapeHtml(field)}</li>`).join("")}</ul>` : ""}</li>`).join("")}</ul><ol>${edges.map((edge) => `<li>${escapeHtml(nodes.find((node) => node.id === edge.from)!.label)} — ${escapeHtml(edge.label)} — ${escapeHtml(nodes.find((node) => node.id === edge.to)!.label)}</li>`).join("")}</ol></details>`;
}

const CSS = `
:root{color-scheme:dark;--canvas:${PALETTE.canvas};--surface:${PALETTE.surface};--raised:${PALETTE.raised};--accent:${PALETTE.accent};--focus:${PALETTE.focus};--text:${PALETTE.text};--muted:${PALETTE.muted};--border:${PALETTE.border};--info:${PALETTE.plan}}
*{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--text);font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}a{color:var(--info)}button,input,textarea,summary,a{touch-action:manipulation}button,input,textarea{font:inherit}button,summary{cursor:pointer}button{min-height:44px;border:1px solid var(--border);border-radius:8px;padding:9px 15px;background:var(--raised);color:var(--text)}button:hover{border-color:var(--focus)}button.primary{background:var(--accent);color:#0b0c0e;font-weight:700;border-color:var(--accent)}button[aria-pressed=true]{border-color:var(--focus);box-shadow:inset 0 -3px var(--focus)}button:disabled{opacity:.65;cursor:default}:focus-visible{outline:3px solid var(--focus);outline-offset:4px}.skip{position:absolute;top:-100px;left:16px;padding:12px;background:var(--surface);z-index:2}.skip:focus{top:8px}header,main,footer{max-width:1280px;margin:auto;padding:24px 32px}header{border-bottom:1px solid var(--border)}.brand,.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.15em;color:var(--focus);font-weight:700}.brand{display:flex;justify-content:space-between;gap:16px}.brand span:last-child{color:var(--muted)}h1{font-size:clamp(28px,4vw,48px);line-height:1.15;letter-spacing:-.035em;margin:25px 0 12px;max-width:850px}h2{font-size:24px;line-height:1.3;margin:5px 0 18px}h3{font-size:17px}p{max-width:80ch}header p{color:var(--muted);margin-bottom:0}.layout{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:28px}.content{min-width:0}.card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:24px;margin-bottom:24px;min-width:0}.path{padding:0;list-style:none;counter-reset:steps}.path li{counter-increment:steps;display:flex;gap:12px;margin:0;padding:14px 0;border-bottom:1px solid var(--border);color:var(--muted)}.path li:before{content:counter(steps,decimal-leading-zero);font:13px/2 ui-monospace,monospace;color:var(--muted)}.path [aria-current=step]{color:var(--text)}.path [aria-current=step]:before{color:var(--focus)}.path-note,.muted,small{color:var(--muted)}nav{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:24px}nav a{min-height:44px;display:flex;align-items:center;padding:6px 14px;border:1px solid var(--border);border-radius:8px;text-decoration:none}.bullets{padding-left:20px}.bullets li{padding:5px 0}.diagram-scroll{overflow:auto;border:1px solid var(--border);border-radius:10px;background:var(--canvas);margin-top:20px}.diagram-scroll svg{display:block;max-width:none}.diagram-node rect{fill:var(--raised);stroke:var(--border);stroke-width:2}.diagram-node.focused rect{stroke:var(--focus);stroke-width:3}.diagram-node text{fill:var(--text);text-anchor:middle;font:15px ui-monospace,monospace}.diagram-node .field-label{fill:var(--muted);font-size:13px}.diagram-edge path{fill:none;stroke:var(--muted);stroke-width:2}.diagram-edge.active path{stroke:var(--focus);stroke-width:3}.edge-label{fill:var(--text);text-anchor:middle;font:13px system-ui,sans-serif;paint-order:stroke;stroke:var(--canvas);stroke-width:6px;stroke-linejoin:round}marker path{fill:var(--muted)}.lifeline{stroke:var(--border);stroke-dasharray:6 6}.focus-controls,.actions{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 8px}.focus-controls button{font-size:14px}#focus-description{font-size:14px;min-height:24px;color:var(--muted)}summary{min-height:44px;padding:10px 0;color:var(--info)}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.7 ui-monospace,monospace;background:var(--canvas);border:1px solid var(--border);padding:18px;border-radius:8px}fieldset{border:0;padding:0;margin:0}legend{margin-bottom:12px}label.option{display:flex;gap:12px;align-items:center;padding:12px;border:1px solid var(--border);border-radius:8px;margin:10px 0;min-height:48px}input[type=radio]{width:20px;height:20px;flex:none;accent-color:var(--focus)}textarea{display:block;resize:vertical;width:100%;min-height:115px;background:var(--canvas);color:var(--text);border:1px solid var(--muted);border-radius:8px;padding:12px;margin-top:8px}#feedback{border-left:3px solid var(--info);padding:8px 14px;min-height:42px}#hints li{padding:6px 0}blockquote{margin:12px 0;padding-left:16px;border-left:2px solid var(--border);white-space:pre-wrap;overflow-wrap:anywhere}.reference{padding:16px 0;border-top:1px solid var(--border)}.reference{overflow-wrap:anywhere}.diagram-tip{font-size:13px}.table-scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:14px}caption{text-align:left;font-weight:600;padding:12px 0}th,td{text-align:left;border-bottom:1px solid var(--border);padding:9px 12px;white-space:nowrap}th{color:var(--info)}footer{color:var(--muted);font-size:13px;border-top:1px solid var(--border)}[hidden]{display:none!important}@media(max-width:850px){.layout{grid-template-columns:minmax(0,1fr)}aside{grid-row:1}.path{display:flex;flex-wrap:wrap;gap:8px}.path li{flex:1 1 170px;padding:6px}.card{padding:18px}header,main,footer{padding:20px}.diagram-scroll{margin-left:0;margin-right:0}h2{font-size:22px}}@media(prefers-reduced-motion:no-preference){button{transition:border-color .12s}}`;

// Only this fixed script executes. Untrusted lesson data is inert JSON and textContent.
const SCRIPT = String.raw`(() => {
'use strict';
const lesson=JSON.parse(document.getElementById('lesson-data').textContent);
const exercise=lesson.exercise;
const byId=id=>document.getElementById(id);
const feedback=byId('feedback');
let hintIndex=0, revealed=false;
const normalize=value=>value.trim().replace(/\s+/g,' ').toLowerCase();
function handoff(command){
  byId('handoff').hidden=false;
  byId('handoff-command').value=command;
  byId('handoff-command').focus(); byId('handoff-command').select();
  byId('handoff-status').textContent='Command selected. Copy it and paste into Neura. This board does not save progress.';
}
function answerCommand(answer){return '/learn '+(revealed||hintIndex?'answer-helped ':'answer ')+answer;}
function currentAnswer(){
  if(exercise.kind==='choice'){const selected=document.querySelector('input[name="answer"]:checked');return selected?selected.value:'';}
  return byId('answer').value.trim();
}
byId('try').addEventListener('click',()=>{byId('practice').scrollIntoView({block:'start',behavior:'auto'});(document.querySelector('input[name="answer"]')||byId('answer')).focus();});
byId('show-example').addEventListener('click',()=>{byId('example').open=true;byId('example').scrollIntoView({block:'center'});});
byId('hint').addEventListener('click',()=>{if(hintIndex<exercise.hints.length){const item=document.createElement('li');item.textContent=exercise.hints[hintIndex++];byId('hints').append(item);byId('hint').textContent=hintIndex===exercise.hints.length?'All hints shown':'Next hint';byId('hint').disabled=hintIndex===exercise.hints.length;}});
byId('reveal').addEventListener('click',()=>{revealed=true;byId('solution').hidden=false;byId('solution-text').textContent=(exercise.kind==='choice'?exercise.options[exercise.answer]:exercise.kind==='short'?(exercise.acceptedAnswers.join(' / ')||'Compare your reasoning with this explanation.'):exercise.solution)+'\n\n'+exercise.explanation;byId('reveal').disabled=true;feedback.textContent='Answer revealed. Try a fresh problem to demonstrate understanding.';});
document.querySelectorAll('[data-focus]').forEach(button=>button.addEventListener('click',()=>{const id=button.dataset.focus;document.querySelectorAll('[data-focus]').forEach(other=>other.setAttribute('aria-pressed',String(other===button)));document.querySelectorAll('[data-node]').forEach(node=>node.classList.toggle('focused',node.dataset.node===id));document.querySelectorAll('.diagram-edge').forEach(edge=>edge.classList.toggle('active',edge.dataset.from===id||edge.dataset.to===id));const node=lesson.diagram.nodes.find(node=>node.id===id);byId('focus-description').textContent=node.detail||node.label;document.querySelector('[data-node="'+id+'"]').scrollIntoView({block:'nearest',inline:'center'});}));
byId('exercise-form').addEventListener('submit',event=>{event.preventDefault();const answer=currentAnswer();if(!answer){feedback.textContent='Enter an answer first.';return;}if(exercise.kind==='sql'){feedback.textContent='SQL runs in Neura’s restricted lab. Paste the selected command there to run and record this attempt.';handoff(answerCommand(answer));return;}if(exercise.kind==='short'&&!exercise.acceptedAnswers.length){feedback.textContent='Open-ended exercise. Send your reasoning to Neura for tutor feedback; this board does not grade it.';return;}const correct=exercise.kind==='choice'?Number(answer)-1===exercise.answer:exercise.acceptedAnswers.some(value=>normalize(value)===normalize(answer));feedback.textContent=(correct?'Matches the expected answer. '+exercise.explanation:exercise.kind==='short'?'No exact match. Try a hint, or ask your tutor to review different wording.':'That choice does not fit yet. Compare the alternatives or try a hint.')+(revealed?' Answer was revealed; this is practice, not mastery.':'')+' Local feedback only. Send your attempt to Neura to record it.';});
byId('record').addEventListener('click',()=>{const answer=currentAnswer();if(!answer){feedback.textContent='Enter an answer first.';return;}handoff(answerCommand(answer));});
document.querySelectorAll('[data-command]').forEach(button=>button.addEventListener('click',()=>handoff('/learn '+button.dataset.command)));
byId('copy-command').addEventListener('click',async()=>{const field=byId('handoff-command');try{await navigator.clipboard.writeText(field.value);byId('handoff-status').textContent='Copied. Paste into Neura.';}catch{field.focus();field.select();byId('handoff-status').textContent='Clipboard unavailable. Command selected; copy it manually.';}});
})();`;

export function renderLearnHtml(lesson: LearnLesson, options: { historical?: boolean } = {}): string {
  assertLearnLesson(lesson);
  const exercise = lesson.exercise;
  const scriptHash = createHash("sha256").update(SCRIPT).digest("base64");
  const styleHash = createHash("sha256").update(CSS).digest("base64");
  const json = JSON.stringify(lesson).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
  const historicalNotice = options.historical ? '<p role="note"><strong>Saved snapshot — source excerpts have not been reverified.</strong> Reimport originals before relying on current citations.</p>' : "";
  const answer = exercise.kind === "choice" ? `<fieldset><legend>Choose one answer</legend>${exercise.options.map((option, index) => `<label class="option"><input type="radio" name="answer" value="${index + 1}"/><span>${escapeHtml(option)}</span></label>`).join("")}</fieldset>` : `<label for="answer">${exercise.kind === "sql" ? "Your SELECT query" : "Your answer"}</label><textarea id="answer" maxlength="8000" spellcheck="false" placeholder="${exercise.kind === "sql" ? "SELECT ..." : "Try it in your own words"}"></textarea>`;
  const tables = exercise.kind === "sql" ? exercise.tables.map((table) => `<div class="table-scroll" tabindex="0" role="region" aria-label="${escapeHtml(table.name)} sample data"><table><caption>${escapeHtml(table.name)} · ${table.rows.length} sample rows</caption><thead><tr>${table.columns.map((column) => `<th scope="col">${escapeHtml(column.name)} <small>${column.type}</small></th>`).join("")}</tr></thead><tbody>${table.rows.map((row) => `<tr>${row.map((cell) => `<td>${cell === null ? "NULL" : escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`).join("") : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'sha256-${styleHash}'; img-src 'none'; connect-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'"><title>${escapeHtml(lesson.title)} · Neura Learn</title><style>${CSS}</style></head><body>
  <a class="skip" href="#concept">Skip to lesson</a><header><div class="brand"><span>Neura / Learn</span><span>Visual workshop</span></div><h1>${escapeHtml(lesson.title)}</h1><p>${escapeHtml(lesson.goal)}</p>${historicalNotice}</header><main><nav aria-label="Lesson sections"><a href="#concept">Understand</a><a href="#practice">Practice</a><a href="#sources">References</a></nav><div class="layout"><div class="content">
  <section class="card" id="concept" aria-labelledby="concept-title"><div class="eyebrow">Concept ${lesson.currentStep + 1} of ${lesson.steps.length}</div><h2 id="concept-title">${escapeHtml(lesson.diagram.title)}</h2>${renderDiagram(lesson.diagram)}<ul class="bullets">${lesson.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul><div class="actions"><button type="button" class="primary" id="try">Let me try</button><button type="button" id="show-example">Show example</button><button type="button" data-command="explain">Explain differently in Neura</button><button type="button" data-command="deeper">Go deeper in Neura</button></div><details id="example"><summary>Worked example · tutor-created</summary><pre>${escapeHtml(lesson.example)}</pre></details></section>
  <section class="card" id="practice" aria-labelledby="practice-title"><div class="eyebrow">Put it to work</div><h2 id="practice-title">${escapeHtml(exercise.prompt)}</h2>${tables}<p class="muted">${exercise.kind === "sql" ? "Read-only, disposable SQL lab. Enter a query here, then run it in Neura. No browser SQL execution." : exercise.kind === "short" ? "Short answers use exact matching when an answer key exists. Open-ended exercises go to your tutor for review." : "Choose an answer, inspect the feedback, then explain why it works."}</p><form id="exercise-form">${answer}<div class="actions"><button class="primary" type="submit">${exercise.kind === "sql" ? "Prepare SQL for Neura" : "Check answer"}</button><button type="button" id="hint">Give a hint</button><button type="button" id="reveal">Reveal answer</button></div></form><ol id="hints" aria-live="polite"></ol><p id="feedback" role="status">Your attempt stays in this browser until you send it to Neura.</p><div id="solution" hidden><h3>Worked answer</h3><pre id="solution-text"></pre></div><button type="button" id="record">Send attempt to Neura</button><p class="muted">Hint and reveal use is included in the command when you send this attempt. A revealed answer never proves mastery.</p></section>
  <section class="card" id="sources" aria-labelledby="sources-title"><div class="eyebrow">Grounded in your materials</div><h2 id="sources-title">References</h2>${historicalNotice}${lesson.references.length ? `<p class="muted">Imported excerpts are reference data. Worked examples and exercise feedback are tutor-created.</p>${lesson.references.map((reference, index) => `<article class="reference"><h3>${index + 1}. ${escapeHtml(reference.filename)} · ${reference.unit} ${reference.number}</h3><blockquote>${escapeHtml(reference.excerpt)}</blockquote><details><summary>Source identity</summary><p><small>${escapeHtml(reference.sourceId)}</small></p></details></article>`).join("")}` : `<p>No imported material cited. This lesson is tutor-created; ask for verification when sources matter.</p>`}</section></div>
  <aside aria-label="Learning path"><div class="card"><div class="eyebrow">Your route</div><h2>One useful step</h2><ol class="path">${lesson.steps.map((step, index) => `<li${index === lesson.currentStep ? ' aria-current="step"' : ""}>${escapeHtml(step)}</li>`).join("")}</ol><p class="path-note">Highlighted step is your current lesson. Progress comes from attempts, not pages read.</p></div><section class="card" id="handoff" hidden aria-labelledby="handoff-title"><h2 id="handoff-title">Continue in Neura</h2><label for="handoff-command">Paste this command in your terminal session</label><textarea id="handoff-command" readonly></textarea><button type="button" id="copy-command">Copy command</button><p id="handoff-status" role="status"></p></section></aside></div></main><footer>Local learning board · No remote resources or automatic progress sync. Reopening resets browser-only attempts and hints.</footer><script type="application/json" id="lesson-data">${json}</script><script>${SCRIPT}</script></body></html>`;
}

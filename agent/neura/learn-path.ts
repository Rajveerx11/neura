import { createHash } from "node:crypto";

export type LearnPath = {
  goal: string;
  targetConceptId: string;
  concepts: { id: string; title: string }[];
  /** Prerequisite first, dependent second. */
  edges: { from: string; to: string }[];
};
export const learnId = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 80;
const compare = (a: string, b: string) => a < b ? -1 : Number(a > b);

/** Bounded Kahn traversal. Input order and locale never affect the curriculum. */
export function learnPathLayers(value: unknown): string[][] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid learning path.");
  const path = value as LearnPath;
  if (typeof path.goal !== "string" || !path.goal.trim() || path.goal.length > 500 || !learnId(path.targetConceptId) || !Array.isArray(path.concepts) || path.concepts.length < 1 || path.concepts.length > 24 || !Array.isArray(path.edges) || path.edges.length > 48) throw new Error("Learning paths require a goal, 1-24 concepts and at most 48 edges.");
  const remaining = new Set<string>();
  for (const concept of path.concepts) {
    if (!concept || !learnId(concept.id) || remaining.has(concept.id) || typeof concept.title !== "string" || !concept.title.trim() || concept.title.length > 160) throw new Error("Path concepts require unique IDs and bounded titles.");
    remaining.add(concept.id);
  }
  if (!remaining.has(path.targetConceptId)) throw new Error("Path target must name an existing concept.");
  const edges = new Set<string>();
  for (const edge of path.edges) {
    if (!edge || !remaining.has(edge.from) || !remaining.has(edge.to) || edge.from === edge.to || edges.has(`${edge.from}:${edge.to}`)) throw new Error("Path edges must uniquely connect different existing concepts.");
    edges.add(`${edge.from}:${edge.to}`);
  }
  const layers: string[][] = [];
  while (remaining.size) {
    const layer = [...remaining].filter(id => !path.edges.some(edge => edge.to === id && remaining.has(edge.from))).sort(compare);
    if (!layer.length) throw new Error("Learning path must be acyclic.");
    layers.push(layer); layer.forEach(id => remaining.delete(id));
  }
  // Every proposed concept must contribute to the stated target, not an unrelated syllabus.
  const relevant = new Set([path.targetConceptId]);
  for (const id of layers.flat().reverse()) if (path.edges.some(edge => edge.from === id && relevant.has(edge.to))) relevant.add(id);
  if (relevant.size !== path.concepts.length) throw new Error("Every concept must be a prerequisite of the goal target.");
  return layers;
}

export function canonicalLearnPath(value: unknown): LearnPath {
  learnPathLayers(value);
  const path = value as LearnPath;
  return { goal: path.goal.trim(), targetConceptId: path.targetConceptId,
    concepts: path.concepts.map(({ id, title }) => ({ id, title: title.trim() })).sort((a, b) => compare(a.id, b.id)),
    edges: path.edges.map(({ from, to }) => ({ from, to })).sort((a, b) => compare(`${a.from}:${a.to}`, `${b.from}:${b.to}`)) };
}
export function learnPathRevision(path: LearnPath): string {
  return createHash("sha256").update(JSON.stringify(canonicalLearnPath(path))).digest("hex");
}
export function learnPrerequisites(path: LearnPath, conceptId: string): string[] {
  const required = new Set<string>();
  for (const id of learnPathLayers(path).flat().reverse()) if (path.edges.some(edge => edge.from === id && (edge.to === conceptId || required.has(edge.to)))) required.add(id);
  return [...required];
}
export function renderLearnPathText(path: LearnPath, current?: string, completed: string[] = [], columns = 80): string {
  const width = Math.max(12, Math.min(120, Number.isFinite(columns) ? Math.floor(columns) : 80));
  const clean = (text: string) => text.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
  const output = [`Goal: ${clean(path.goal)}`];
  for (const [layer, ids] of learnPathLayers(path).entries()) {
    output.push(`Layer ${layer + 1}`);
    for (const id of ids) {
      let status = completed.includes(id) ? "Done" : "Upcoming";
      if (id === current) status = "Current";
      output.push(`${status}: ${id} - ${clean(path.concepts.find(node => node.id === id)!.title)}`);
    }
  }
  const wrapped: string[] = [];
  const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });
  for (const line of output) {
    let row = ""; let cells = 0;
    for (const { segment } of graphemes.segment(line)) {
      // Conservatively reserve two terminal cells for non-ASCII graphemes.
      const span = /^[\x20-\x7e]$/.test(segment) ? 1 : 2;
      if (cells + span > width) { wrapped.push(row); row = ""; cells = 0; }
      row += segment; cells += span;
    }
    wrapped.push(row);
  }
  return wrapped.join("\n");
}

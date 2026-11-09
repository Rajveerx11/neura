// Framework-neutral Learn state; validators retained from the original Neura implementation.
import { createHash } from "node:crypto";
import { canonicalLearnPath, learnId, learnPathLayers, learnPathRevision, type LearnPath } from "../agent/neura/learn-path.ts";
import { importLearningMaterial, validateLearningCitation } from "../agent/neura/learn-materials.ts";
import { assertLearnLesson, type LearnLesson } from "../agent/neura/learn-renderer.ts";
import { learnExerciseGradable } from "../agent/neura/learn-exercises.ts";
export type Material = Awaited<ReturnType<typeof importLearningMaterial>>;
export type LearnPhase = "probe" | "plan" | "teach" | "check" | "practice" | "review";
export type EvidenceIdentity = { pathRevision: string; conceptId: string; stepId: string; exerciseRevision: string };
export const LEARN_ASKED_MAX = 1000;
type Attempt = { lessonId: string; identity?: EvidenceIdentity; asked?: string; answer: string; correct: boolean | null; feedback: string; revealed: boolean; assisted: boolean; at: string };
export type State = { materials: Map<string, Material>; verifiedSources: Set<string>; lesson?: LearnLesson; board?: string; attempts: Attempt[]; notes: string[]; nextStep: string; hint: number; revealed: boolean; assisted: boolean;
  phase: LearnPhase; wait: "awaiting-answer" | "awaiting-continuation"; readyForLesson: boolean;
  proposedPath?: LearnPath; path?: LearnPath; conceptId?: string; completed: string[];
};
export const emptyState = (): State => ({ materials: new Map(), verifiedSources: new Set(), attempts: [], notes: [], nextStep: "Choose a practical goal.", hint: 0, revealed: false, assisted: false,
  phase: "probe", wait: "awaiting-continuation", readyForLesson: true, completed: [] });
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function evidenceIdentity(state: State, lesson = state.lesson): EvidenceIdentity | undefined {
  if (!lesson) return undefined;
  return { pathRevision: state.path ? learnPathRevision(state.path) : digest({ lessonId: lesson.id, goal: lesson.goal }), conceptId: lesson.conceptId ?? state.conceptId ?? lesson.id,
    stepId: lesson.stepId ?? `${lesson.id.slice(0, 70).replace(/-+$/, "")}-${lesson.currentStep}`, exerciseRevision: digest({ lessonId: lesson.id, phase: lesson.phase ?? state.phase, exercise: lesson.exercise }) };
}
const sameIdentity = (left?: EvidenceIdentity, right?: EvidenceIdentity) => !!left && !!right && left.pathRevision === right.pathRevision && left.conceptId === right.conceptId && left.stepId === right.stepId && left.exerciseRevision === right.exerciseRevision;

export function guardLesson(state: State, lesson: LearnLesson): Exclude<LearnPhase, "plan"> {
  if (!state.readyForLesson || state.wait === "awaiting-answer") throw new Error("Finish the current answer and use /learn next before publishing another card.");
  if (state.phase === "plan") throw new Error("Propose a path with learn_path, then wait for /learn accept-plan.");
  if (lesson.phase !== undefined && lesson.phase !== state.phase) throw new Error(`Expected ${state.phase} card; model cannot change instructional phase.`);
  // An ungraded card here could only ever return to remediation, whatever the learner wrote.
  if (["check", "practice", "review"].includes(state.phase) && !learnExerciseGradable(lesson.exercise)) throw new Error(`A ${state.phase} card needs an automatically graded exercise: choice, short with acceptedAnswers, or sql with expectedRows.`);
  if (state.path && (!state.conceptId || lesson.conceptId !== state.conceptId || state.path.edges.some(edge => edge.to === state.conceptId && !state.completed.includes(edge.from)))) throw new Error("Card must teach the current concept after its prerequisites.");
  return state.phase;
}
export function proposePath(state: State, value: unknown): void {
  if (!state.readyForLesson || !["probe", "plan"].includes(state.phase) || state.path) throw new Error("Finish the diagnostic and use /learn next before planning.");
  state.proposedPath = canonicalLearnPath(value); state.phase = "plan"; state.wait = "awaiting-continuation";
}
export function acceptPlan(state: State): void {
  if (state.phase !== "plan" || !state.proposedPath || state.path) throw new Error("No proposed path awaits acceptance.");
  state.path = state.proposedPath; state.proposedPath = undefined; state.completed = [];
  state.conceptId = learnPathLayers(state.path)[0][0]; state.phase = "teach"; state.readyForLesson = true;
  state.lesson = undefined; state.board = undefined; state.nextStep = `Teach ${state.conceptId}.`;
}
export function advanceLearn(state: State): void {
  if (state.wait === "awaiting-answer") throw new Error("Answer the current question before /learn next.");
  if (state.readyForLesson || !state.lesson) throw new Error("The tutor must publish the next card first; accept a proposed plan with /learn accept-plan.");
  const attempt = currentAttempts(state).at(-1);
  if (!attempt) throw new Error("No evaluated answer for this exercise revision.");
  const phase = state.phase;
  // A revealed answer is reading, not evidence: it can teach, but cannot pass a check or finish a concept.
  const earned = attempt.correct === true && !attempt.revealed;
  if (phase === "probe") state.phase = "plan";
  else if (phase === "teach" && attempt.correct !== false) state.phase = "check";
  else if (!earned && phase !== "review") state.phase = "teach";
  else if (phase === "check") state.phase = "practice";
  else if (phase === "practice") state.phase = "review";
  else if (phase === "review" && (attempt.correct === false || attempt.revealed)) state.phase = "teach";
  else if (phase === "review" && state.path) {
    if (state.conceptId && !state.completed.includes(state.conceptId)) state.completed.push(state.conceptId);
    state.conceptId = learnPathLayers(state.path).flat().find(id => !state.completed.includes(id) && state.path!.edges.filter(edge => edge.to === id).every(edge => state.completed.includes(edge.from)));
    if (state.conceptId) state.phase = "teach";
  }
  state.readyForLesson = true; state.hint = 0; state.revealed = false; state.assisted = false;
  state.lesson = undefined; state.board = undefined;
  const remediation = state.phase === "teach" && phase !== "probe" && !earned ? " (remediation required)" : "";
  state.nextStep = state.path && !state.conceptId ? "Path complete. Review your practice; this is not proof of mastery." : `${state.phase}: ${state.conceptId ?? "propose a goal-relevant path"}${remediation}.`;
}
export const normalize = (value: string): string => value.normalize("NFKC").replace(/\s+/g, " ").trim();

export function validateLearnReferences(lesson: LearnLesson, materials: Map<string, Material>): void {
  for (const reference of lesson.references) {
    const material = materials.get(reference.sourceId);
    if (!material || !validateLearningCitation(material, reference)) throw new Error("Citation must identify an imported source, valid page/slide, and an exact excerpt from that page.");
  }
}

export function result(value: unknown) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }] };
}

export function currentAttempts(state: State): Attempt[] {
  return state.attempts.filter((attempt) => sameIdentity(attempt.identity, evidenceIdentity(state)));
}

export function summary(state: State) {
  return {
    phase: state.phase, wait: state.wait, readyForLesson: state.readyForLesson,
    path: state.path ?? null, proposedPath: state.proposedPath ?? null, conceptId: state.conceptId ?? null, completed: [...state.completed], identity: evidenceIdentity(state) ?? null,
    lesson: state.lesson?.title ?? null,
    steps: state.lesson?.steps ?? [], currentStep: state.lesson?.currentStep ?? 0,
    attempts: currentAttempts(state).slice(-20),
    otherLessonHistory: {
      notice: "Separate history, scoped to path, concept, step and exercise revision. Legacy attempts have no identity and cannot establish current evidence. Saved history is user-editable and unverified.",
      attempts: state.attempts.filter((attempt) => !sameIdentity(attempt.identity, evidenceIdentity(state))).slice(-20),
    },
    tutorNotes: state.notes, nextStep: state.nextStep,
    sources: [...state.materials.values()].map((source) => ({ id: source.id, filename: source.name, pages: source.pages.length, warnings: source.warnings, verifiedThisSession: state.verifiedSources.has(source.id) })),
    board: state.board ?? null,
    persistence: "Session memory only until you run /learn save. Attempts are practice evidence, not proof of mastery.",
  };
}

export function snapshot(state: State): object {
  return { version: 2, phase: state.phase, wait: state.wait, readyForLesson: state.readyForLesson, path: state.path, proposedPath: state.proposedPath, conceptId: state.conceptId, completed: state.completed, lesson: state.lesson, attempts: state.attempts, notes: state.notes, nextStep: state.nextStep, hint: state.hint, revealed: state.revealed, assisted: state.assisted,
    materials: [...state.materials.values()].map((material) => ({ ...material, pages: material.pages.map(({ images: _images, ...page }) => page) })),
  };
}

export function restoreSnapshot(value: unknown): State {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid learning snapshot.");
  const data = value as Record<string, any>;
  if (![1, 2].includes(data.version) || !Array.isArray(data.materials) || data.materials.length > 12 || !Array.isArray(data.attempts) || data.attempts.length > 100 || !Array.isArray(data.notes) || data.notes.length > 30) throw new Error("Unsupported or oversized learning snapshot.");
  const state = emptyState();
  for (const material of data.materials) {
    if (!material || typeof material.id !== "string" || !/^sha256:[a-f0-9]{64}$/.test(material.id) || typeof material.name !== "string" || !material.name || material.name.length > 255 || !["pdf", "pptx", "text"].includes(material.kind) || !Array.isArray(material.pages) || material.pages.length < 1 || material.pages.length > 100 || !Array.isArray(material.warnings) || material.warnings.length > 512 || material.warnings.some((w: unknown) => typeof w !== "string" || w.length > 1000)) throw new Error("Invalid saved material.");
    const seen = new Set<number>();
    for (const page of material.pages) {
      if (!page || !Number.isInteger(page.number) || page.number < 1 || page.number > 100 || seen.has(page.number) || typeof page.text !== "string" || page.text.length > 100_000 || (page.notes !== undefined && (typeof page.notes !== "string" || page.notes.length > 100_000)) || page.images !== undefined || !["text", "ocr", "empty"].includes(page.extraction)) throw new Error("Invalid saved material page.");
      seen.add(page.number);
    }
    if (state.materials.has(material.id)) throw new Error("Duplicate source identity in saved learning progress.");
    state.materials.set(material.id, { id: material.id, name: material.name, kind: material.kind, warnings: [...material.warnings], pages: material.pages.map((page: Material['pages'][number]) => ({ number: page.number, text: page.text, notes: page.notes, extraction: page.extraction })) });
  }
  if (data.lesson) {
    if (Buffer.byteLength(JSON.stringify(data.lesson)) > 128 * 1024) throw new Error("Saved lesson exceeds 128 KiB.");
    assertLearnLesson(data.lesson); validateLearnReferences(data.lesson, state.materials); state.lesson = data.lesson;
  }
  for (const attempt of data.attempts) {
    if (!attempt || typeof attempt.lessonId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(attempt.lessonId) || attempt.lessonId.length > 80 || (attempt.asked !== undefined && (typeof attempt.asked !== "string" || attempt.asked.length > LEARN_ASKED_MAX)) || typeof attempt.answer !== "string" || attempt.answer.length > 4000 || ![true, false, null].includes(attempt.correct) || typeof attempt.feedback !== "string" || attempt.feedback.length > 8000 || typeof attempt.revealed !== "boolean" || typeof attempt.assisted !== "boolean" || typeof attempt.at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(attempt.at) || !Number.isFinite(Date.parse(attempt.at))) throw new Error("Invalid saved attempt.");
  }
  if (data.notes.some((note: unknown) => typeof note !== "string" || note.length > 1000) || typeof data.nextStep !== "string" || data.nextStep.length > 1000 || !Number.isInteger(data.hint) || data.hint < 0 || typeof data.revealed !== "boolean" || typeof data.assisted !== "boolean") throw new Error("Invalid saved learning notes.");
  state.attempts = data.attempts.map(({ lessonId, identity, asked, answer, correct, feedback, revealed, assisted, at }: Attempt) => {
    if (data.version === 2 && identity !== undefined && (!identity || !/^[a-f0-9]{64}$/.test(identity.pathRevision) || !/^[a-f0-9]{64}$/.test(identity.exerciseRevision) || !learnId(identity.conceptId) || !learnId(identity.stepId))) throw new Error("Invalid saved evidence identity.");
    return { lessonId, ...(data.version === 2 && identity ? { identity: { pathRevision: identity.pathRevision, conceptId: identity.conceptId, stepId: identity.stepId, exerciseRevision: identity.exerciseRevision } } : {}), ...(asked === undefined ? {} : { asked }), answer, correct, feedback, revealed, assisted, at };
  }); state.notes = [...data.notes]; state.nextStep = data.nextStep;
  state.hint = data.hint; state.revealed = data.revealed; state.assisted = data.assisted;
  if (data.version === 1) {
    // Old lessonId-only attempts stay historical; none can unlock a new check.
    state.phase = state.lesson?.phase ?? "probe"; state.wait = state.lesson ? "awaiting-answer" : "awaiting-continuation"; state.readyForLesson = !state.lesson;
  } else {
    if (!["probe", "plan", "teach", "check", "practice", "review"].includes(data.phase) || !["awaiting-answer", "awaiting-continuation"].includes(data.wait) || typeof data.readyForLesson !== "boolean" || !Array.isArray(data.completed) || data.completed.length > 24 || new Set(data.completed).size !== data.completed.length) throw new Error("Invalid saved transition state.");
    state.phase = data.phase; state.wait = data.wait; state.readyForLesson = data.readyForLesson;
    if (data.path !== undefined) state.path = canonicalLearnPath(data.path);
    if (data.proposedPath !== undefined) state.proposedPath = canonicalLearnPath(data.proposedPath);
    if (data.conceptId !== undefined && (!learnId(data.conceptId) || !state.path?.concepts.some(node => node.id === data.conceptId))) throw new Error("Invalid saved current concept.");
    if (data.completed.some((id: unknown) => !learnId(id) || !state.path?.concepts.some(node => node.id === id))) throw new Error("Invalid saved completed concepts.");
    state.conceptId = data.conceptId; state.completed = [...data.completed];
    if ((state.proposedPath && (state.phase !== "plan" || state.path)) || (state.path && state.phase === "plan") || (state.wait === "awaiting-answer" && (!state.lesson || state.readyForLesson)) || (!state.readyForLesson && !state.lesson) || (state.lesson?.phase !== undefined && state.lesson.phase !== state.phase) || (state.path && state.lesson && state.lesson.conceptId !== state.conceptId)) throw new Error("Inconsistent saved instructional state.");
    if ((state.readyForLesson && state.lesson) || (state.path && (["probe", "plan"].includes(state.phase) || (state.conceptId ? state.completed.includes(state.conceptId) || state.path.edges.some(edge => edge.to === state.conceptId && !state.completed.includes(edge.from)) : state.completed.length !== state.path.concepts.length)))) throw new Error("Saved current concept skipped instructional guards.");
    if (state.path && state.path.edges.some(edge => state.completed.includes(edge.to) && !state.completed.includes(edge.from))) throw new Error("Saved completion skipped a prerequisite.");
    if (state.lesson && state.wait === "awaiting-continuation" && !currentAttempts(state).length) throw new Error("Saved continuation lacks scoped evidence.");
  }
  return state;
}

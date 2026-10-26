// Framework-neutral Learn state; validators retained from the original Neura implementation.
import { importLearningMaterial, validateLearningCitation } from "../agent/neura/learn-materials.ts";
import { assertLearnLesson, type LearnLesson } from "../agent/neura/learn-renderer.ts";
export type Material = Awaited<ReturnType<typeof importLearningMaterial>>;
type Attempt = { lessonId: string; answer: string; correct: boolean | null; feedback: string; revealed: boolean; assisted: boolean; at: string };
export type State = { materials: Map<string, Material>; verifiedSources: Set<string>; lesson?: LearnLesson; board?: string; attempts: Attempt[]; notes: string[]; nextStep: string; hint: number; revealed: boolean; assisted: boolean };
export const emptyState = (): State => ({ materials: new Map(), verifiedSources: new Set(), attempts: [], notes: [], nextStep: "Choose a practical goal.", hint: 0, revealed: false, assisted: false });
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
  return state.attempts.filter((attempt) => attempt.lessonId === state.lesson?.id);
}

export function summary(state: State) {
  return {
    lesson: state.lesson?.title ?? null,
    steps: state.lesson?.steps ?? [], currentStep: state.lesson?.currentStep ?? 0,
    attempts: currentAttempts(state).slice(-20),
    otherLessonHistory: {
      notice: "Separate lesson history, identified by lessonId. Saved history is user-editable and unverified; it is not evidence for the current lesson.",
      attempts: state.attempts.filter((attempt) => attempt.lessonId !== state.lesson?.id).slice(-20),
    },
    tutorNotes: state.notes, nextStep: state.nextStep,
    sources: [...state.materials.values()].map((source) => ({ id: source.id, filename: source.name, pages: source.pages.length, warnings: source.warnings, verifiedThisSession: state.verifiedSources.has(source.id) })),
    board: state.board ?? null,
    persistence: "Session memory only until you run /learn save. Attempts are practice evidence, not proof of mastery.",
  };
}

export function snapshot(state: State): object {
  return { version: 1, lesson: state.lesson, attempts: state.attempts, notes: state.notes, nextStep: state.nextStep, hint: state.hint, revealed: state.revealed, assisted: state.assisted,
    materials: [...state.materials.values()].map((material) => ({ ...material, pages: material.pages.map(({ images: _images, ...page }) => page) })),
  };
}

export function restoreSnapshot(value: unknown): State {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid learning snapshot.");
  const data = value as Record<string, any>;
  if (data.version !== 1 || !Array.isArray(data.materials) || data.materials.length > 12 || !Array.isArray(data.attempts) || data.attempts.length > 100 || !Array.isArray(data.notes) || data.notes.length > 30) throw new Error("Unsupported or oversized learning snapshot.");
  const state = emptyState();
  for (const material of data.materials) {
    if (!material || typeof material.id !== "string" || !/^sha256:[a-f0-9]{64}$/.test(material.id) || typeof material.name !== "string" || !material.name || material.name.length > 255 || !["pdf", "pptx"].includes(material.kind) || !Array.isArray(material.pages) || material.pages.length < 1 || material.pages.length > 100 || !Array.isArray(material.warnings) || material.warnings.length > 512 || material.warnings.some((w: unknown) => typeof w !== "string" || w.length > 1000)) throw new Error("Invalid saved material.");
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
    if (!attempt || typeof attempt.lessonId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(attempt.lessonId) || attempt.lessonId.length > 80 || typeof attempt.answer !== "string" || attempt.answer.length > 4000 || ![true, false, null].includes(attempt.correct) || typeof attempt.feedback !== "string" || attempt.feedback.length > 8000 || typeof attempt.revealed !== "boolean" || typeof attempt.assisted !== "boolean" || typeof attempt.at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(attempt.at) || !Number.isFinite(Date.parse(attempt.at))) throw new Error("Invalid saved attempt.");
  }
  if (data.notes.some((note: unknown) => typeof note !== "string" || note.length > 1000) || typeof data.nextStep !== "string" || data.nextStep.length > 1000 || !Number.isInteger(data.hint) || data.hint < 0 || typeof data.revealed !== "boolean" || typeof data.assisted !== "boolean") throw new Error("Invalid saved learning notes.");
  state.attempts = data.attempts.map(({ lessonId, answer, correct, feedback, revealed, assisted, at }) => ({ lessonId, answer, correct, feedback, revealed, assisted, at })); state.notes = [...data.notes]; state.nextStep = data.nextStep;
  state.hint = data.hint; state.revealed = data.revealed; state.assisted = data.assisted;
  return state;
}

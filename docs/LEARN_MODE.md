# Learn Mode: visual, practical learning

Status: implementation reference, not a shipped capability. Requested 2026-09-07.

## Outcome

Learn Mode is a native Neura mode for technical and nontechnical subjects. The
learner prefers practical tasks, flowcharts and ER diagrams, and short bullets.
PDFs and PowerPoint decks should ground lessons in the learner's own material.

## Learning experience

1. Enter `/mode learn` or select Learn using the existing mode controls.
2. Establish a concrete goal, time budget, and starting knowledge with at most a
   few optional questions. Respect requests to skip assessment or hear an explanation.
3. Show a short learning path and a useful real-world task.
4. Teach one concept using a readable diagram, 3-5 key bullets, and an example.
5. Let the learner predict, modify, query, debug, or explain. Provide progressive
   hints and specific feedback. Distinguish graded questions from subjective work.
6. Record evidence from attempts, misconceptions, and the next step. Reading or
   revealing an answer never proves mastery. Resume saved work only on request.

## First-release scope

- Native mode, tool restrictions, prompt, session restoration, and terminal status.
- PDF and PPTX ingestion: text, page/slide numbering, slide notes where available,
  visual page inspection, and OCR fallback with explicit limitations. Legacy `.ppt`
  must produce an actionable conversion message unless a tested converter exists.
- Grounding by immutable source identity plus page/slide, with citations validated
  against imported material. Treat all document content as untrusted reference data.
  Distinguish source-supported claims, outside sources, and tutor examples.
- A local browser learning board: accessible flow, ER, and sequence diagrams;
  short lesson bullets; reference excerpts; exercises; hint and reveal controls.
  Browser actions must actually work, with clear handoff to the terminal where needed.
- Practical exercises, including a constrained SQL/table lab or equally useful
  contained execution environment. No arbitrary host-code execution.
- Optional local learning progress and controlled material/lesson storage. No
  unsolicited transcript export, external sync, or modifications to source documents.

## Architecture and ownership

- Mode agent: mode registry, mode UI/prompt, deterministic allowlist, all existing
  mode-sensitive background hooks, and mode regression tests.
- Materials agent: document extraction module, bounded input validation, source
  identity and citations, dependency provisioning if needed, and synthetic fixtures.
- Workshop agent: structured lesson model, HTML/SVG rendering, interactive exercises,
  accessible browser checks, and safe evaluation with no arbitrary code.
- Orchestrator: Learn extension/tool wiring, controlled artifact/progress storage,
  cross-component tests, documentation, installer integration, independent review,
  one integrated PR, and CI. Agents work in separate Git worktrees.

Provisional tool names: `learn_material`, `learn_lesson`, `learn_exercise`, and
`learn_progress`. Shared modules live directly under `agent/neura/`; the extension
is `agent/extensions/learn.ts`. Coordinate exported interfaces before integration.

## Permission boundary

Learn permits bounded research, approved material reads, interactive questions,
and its dedicated learning tools. Generic writes/edits, arbitrary shell commands,
remote mutation, Plan publication, and Human Away execution are unavailable.
Dedicated writers use canonical junction-aware containment and bounded payloads.
Background proof, checkpoint, memory, and integration hooks must not bypass this
boundary. Plain Pi remains stock, Plan keeps its existing contract, Human Away
stays preview-only, and the logo-only launch remains unchanged.

## Delivery and verification

- Preserve existing uncommitted work. Integrate only scoped commits from isolated
  worktrees; do not install into the live harness or merge the PR.
- Use task-to-pr workflow: acceptance, implementation, meaningful tests, independent
  review, scoped commit/push/PR, and required CI. No guarantee of zero defects.
- New runtime dependencies need exact pins, source review, documentation, and tests.
- Test valid inputs and denied traversal, links, forged citations, oversized/malformed
  documents, untrusted markup, prohibited execution, mode transitions, and restore.
- Exercise PDF and PPTX ingestion through a rendered lesson and a practical attempt.
- Inspect real browser behavior at desktop and narrow widths; verify keyboard and
  accessibility behavior. Test missing OCR/converter tools with honest diagnostics.
- Required checks: `node scripts/verify-harness.mjs`, `node scripts/check-docs.mjs`,
  `git diff --check`, TypeScript, and new Learn-focused suites.
- Update this reference with delivered behavior and precise limitations after checks.

## Inspiration

https://github.com/amosblomqvist/learn — adopt connected concepts, adaptive teaching,
quizzes, and useful visuals. Build original Neura integration; avoid copying a
personal tutor's rigid assessment or treating all subjects as unconditional truths.

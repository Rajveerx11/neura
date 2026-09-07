# Learn Mode: visual, practical learning

Status: implemented on the Learn feature branch, unreleased and not installed in
the live harness. Requested 2026-09-07. Delivery evidence is recorded below.

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

## Implemented experience

- Native mode, tool restrictions, prompt, session restoration, and terminal status.
- PDF and PPTX ingestion: text, page/slide numbering, slide notes where available,
  visual page inspection, and OCR fallback with explicit limitations. Legacy `.ppt`
  must produce an actionable conversion message unless a tested converter exists.
- Grounding by immutable source identity plus page/slide, with citations validated
  against imported material. Treat all document content as untrusted reference data.
  Distinguish source-supported claims, outside sources, and tutor examples.
- A standalone local browser learning board: accessible flow, ER, and sequence diagrams;
  short lesson bullets; reference excerpts; exercises; hint and reveal controls.
  Browser quizzes grade locally; revision-bound copy controls hand attempts and
  explanation requests to the terminal. The board does not silently sync state.
- Practical choice, short-answer, open-ended, and SQL exercises. SQL queries run
  against provided sample tables in a disposable in-memory SQLite process with
  an authorizer, a three-second deadline, and bounded memory/results. No arbitrary
  host-code execution. Worked SQL answer keys are checked before publication.
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

Tool names: `learn_material`, `learn_lesson`, `learn_exercise`, and
`learn_progress`. Shared modules live directly under `agent/neura/`; the extension
is `agent/extensions/learn.ts`. Coordinate exported interfaces before integration.

## Permission boundary

Learn permits bounded `read`/`ls`, web research, material reads, interactive questions,
and its dedicated learning tools. Generic writes/edits, arbitrary shell commands,
remote mutation, Plan publication, and Human Away execution are unavailable.
Dedicated writers use canonical junction-aware containment and bounded payloads.
Background proof, checkpoint, memory, and integration hooks must not bypass this
boundary. Plain Pi remains stock, Plan keeps its existing contract, Human Away
stays preview-only, and the logo-only launch remains unchanged.

Work remains the default; Learn is the fifth mode. Work proof uses the existing
network-disabled WSL2 bubblewrap environment. Its runner and packages must already
be available there; unavailable proof never falls back to host execution. YOLO
retains bounded host proof. Mode changes are locked during capture and verification.
If a new session starts before old background work finishes, it holds safe Work
state with tools paused, then restores the requested restricted mode after drain.
Saved YOLO still requires fresh confirmation; old verification cannot earn a new receipt.
Checkpoints/undo, host health diagnostics, private memory, skill reports, and October
remain YOLO-only so background operations cannot bypass Work or Learn restrictions.

Stock `grep` and `find` are excluded: inherited ripgrep configuration can change
their targets or execute preprocessors. Generic reads deny hidden paths, private
memory/session/approval/configuration files, alternate streams, hardlinks, and
linked paths. `ls` refuses linked children rather than following them.

Learning files live in `.neura-learning/` with an ownership marker and Git exclusion.
First use prepares markers in a unique sibling directory before atomic publication,
so concurrent saves see a complete directory and interrupted initialization can retry.
Unpublished initialization directories contain metadata only and may remain after
interruption or a lost publication race; Neura does not recursively clean these paths.
Writers create exclusive files, validate the opened handle and canonical parent
before writing content, and check again afterward. These checks are application
controls, not an OS sandbox against a hostile same-user process relocating paths.
The parser likewise uses reviewed native/WASM dependencies; resource limits do
not eliminate native parser vulnerability risk.

## Commands and persistence

- `/learn status`: current lesson, step, attempts, next action, and board path.
- `/learn answer <text or SQL>`: submit to the active exercise.
- `/learn answer-helped <text or SQL>`: record an assisted attempt.
- `/learn hint`, `/learn reveal`: progressive help; assistance stays recorded.
- `/learn explain`, `/learn deeper`, `/learn example`: ask the tutor to continue.
- `/learn save`: explicitly save the current lesson, source text/notes, and attempts.
- `/learn saved`: newest 100 snapshots; `/learn resume <filename>` restores one.
- `/learn reset`: clear in-memory learning state without deleting saved work.

Browser-generated commands include a lesson revision and reject stale boards.
New sessions start without learning content until explicitly resumed. Saved
images are omitted; reimport sources for visual inspection. Restored excerpts
are historical and unverified, visibly labelled on the board. A new citation
requires reimporting the original. The tutor retrieves full resumed lesson data
through `learn_progress`, including diagrams and SQL tables.
Attempt counts and current progress include only the active lesson. Attempts with
other lesson IDs remain separately labelled, unverified history, including after resume.

## Limits and deliberate boundaries

- Node.js 24.10+ is required. Runtime dependencies have a separate exact lockfile;
  install with `npm ci --prefix agent/neura --ignore-scripts` for development.
- At most 12 materials per learning session, 25 MiB and 100 pages/slides per file.
  OCR is offline English. Full PPTX layout, SmartArt, charts, and legacy PPT require
  PDF/PPTX export as documented in [LEARN_DEPENDENCIES.md](LEARN_DEPENDENCIES.md).
- Lessons contain 3-5 bullets and small diagrams (2-6 nodes), with text alternatives
  and horizontal diagram scrolling on narrow screens. No arbitrary model HTML/JS.
- Short answers with an answer key use exact normalized matching; open-ended work
  has no automatic grade. SQL grading includes column names and duplicate rows,
  ignores ordering, and does not grade truncated output. No mastery score is inferred.
- Browser progress is local until handed to Neura. This is a self-study workshop,
  not an exam system: browser source contains the worked answers.

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

## Delivery evidence

Local verification passed on 2026-09-07: TypeScript, all 17 harness extensions,
documentation/whitespace, 43 material assertions, 44 storage checks, 71 integrated
assertions, workshop evaluator tests, and Learn/Plan desktop/mobile browser scans.
Both dependency graphs reported zero known vulnerabilities; all 31 installed
Learn runtime packages had verified registry signatures (13 attestations).
Independent review findings were fixed and rechecked. CI status remains the PR's
source of truth; this local evidence does not claim a live installation or release.

- `verify-harness.mjs`: 17 isolated suites, real Pi loader, all 17 extensions, mode/provider boundaries,
  private reads/ADS/hardlinks, background hooks, restore, and existing-mode regressions.
- `verify-learn-materials.mjs`: real synthetic PDF/PPTX/OCR and malformed-input tests.
- `verify-learn-workshop.mjs`: diagram validation, escaping, exercise grading, SQL
  denial/resource limits, and numeric edge cases.
- `verify-learn-storage.mjs`: real filesystem link/open interleavings, no content
  disclosure through tested swaps, and static hardlink/path denials.
- `verify-learn.mjs`: actual tools from PDF/PPTX import through cited lesson, attempt,
  SQL, explicit save/resume, forged/stale answers, and saved-input limits.
- `verify-learn-browser.mjs`: desktop/mobile Edge, keyboard interactions, functional
  controls, CSP and no-network assertions, and axe accessibility scans.
- Independent reviews cross-check components authored by other agents. Valid
  findings receive fixes and regression coverage before the integrated PR.

## Inspiration

https://github.com/amosblomqvist/learn — adopt connected concepts, adaptive teaching,
quizzes, and useful visuals. Build original Neura integration; avoid copying a
personal tutor's rigid assessment or treating all subjects as unconditional truths.

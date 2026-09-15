# Learn Mode: visual, practical learning

Status: merged in [PR #44](https://github.com/Rajveerx11/neura/pull/44) on
2026-09-07, unreleased. No live install was performed by this delivery.
See [STATUS.md](STATUS.md) for the audited source revision and release state.

## Outcome

Learn Mode teaches technical and nontechnical subjects through practical tasks,
flowcharts and ER diagrams, and short bullets. Local PDFs and PowerPoint decks
can ground lessons in the learner's own material.

## Quick start

Enter `/mode learn`, then give a concrete goal:

> Help me design a small shop database. Use an ER diagram, 3-5 bullets, and one
> SQL exercise. Reference `materials/database-basics.pdf` when relevant.

The path is an example: use your own ordinary file inside the workspace. Ask the
tutor to import it and publish a lesson board. Open the returned local HTML path,
try the exercise, and submit the board's copied command to Neura. In the terminal,
`/learn answer <text or SQL>` submits to the active exercise. Use `/learn hint`
for help and `/learn save` when you want to keep progress.

For nontechnical learning, a practical goal can be a customer conversation or
project plan. Open-ended exercises receive discussion, not an automatic grade.

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
  PDF page previews, embedded PPTX image previews, and bounded offline OCR.
  Legacy `.ppt` returns an actionable PDF/PPTX export message; no converter runs.
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
- Optional local learning progress and controlled material/lesson storage.
- Optional machine-local Obsidian capture: minimized concepts, practice evidence,
  findings, and structured teaching preferences are written automatically beneath
  an owned `Neura/` subtree. Raw answers and transcripts are not exported, and
  source documents or unrelated vault notes are never modified.

## Implementation map

| Component | Source responsibility |
|---|---|
| Mode registry and policy | `modes.ts`, `mode-state.ts`, `learn-policy.ts`: selection, prompts, allowlist, private paths, and background-operation boundaries |
| Document imports | `learn-materials.ts`, `learn-materials-worker.mjs`: captured bytes, extraction/OCR, immutable identity, and citation validation |
| Lesson workshop | `learn-schema.ts`, `learn-renderer.ts`, `learn-exercises.ts`: structured lessons, HTML/SVG, practice, and bounded SQLite |
| Tools and persistence | `learn.ts`, `learn-store.ts`: four tools, `/learn`, controlled boards, snapshots, and explicit resume |
| Automatic knowledge capture | `learn-vault.ts`, `learn-files.ts`: machine-local vault opt-in, immutable events, safe Markdown projections, bounded learner-profile retrieval |

Tool names: `learn_material`, `learn_lesson`, `learn_exercise`, and
`learn_progress`. Shared modules live directly under `agent/neura/`; the extension
is `agent/extensions/learn.ts`.

## Permission boundary

Learn permits bounded `read`/`ls`, web research, material reads, interactive questions,
and its dedicated learning tools. Generic writes/edits, arbitrary shell commands,
remote mutation, Plan publication, and Human Away execution are unavailable.
Dedicated writers use canonical junction-aware containment and bounded payloads.
Background proof, checkpoint, memory, and integration hooks must not bypass this
boundary. Plain Pi remains stock, Plan keeps its existing contract, Human Away
stays preview-only, and the image-backed launch remains outside Learn policy.

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

Workspace learning files live in `.neura-learning/` with an ownership marker and Git exclusion.
First use prepares markers in a unique sibling directory before atomic publication,
so concurrent saves see a complete directory and interrupted initialization can retry.
First initialization requires native Windows: its directory publication refuses an
existing target atomically. Node's POSIX directory rename can replace an unowned
empty target, so first initialization there fails before writing. Existing validated
Learn stores remain usable; Neura does not create them through WSL/POSIX.
Unpublished initialization directories contain metadata only and may remain after
interruption or a lost publication race; Neura does not recursively clean these paths.
Writers create exclusive files, validate the opened handle and canonical parent
before writing content, and check again afterward. These checks are application
controls, not an OS sandbox against a hostile same-user process relocating paths.
The parser likewise uses reviewed native/WASM dependencies; resource limits do
not eliminate native parser vulnerability risk.

### Automatic Obsidian knowledge capture

Vault capture is disabled unless an absolute non-UNC Obsidian vault path is
supplied through `NEURA_LEARN_VAULT` or the private file
`~/.pi/agent/neura/learn-vault.json` with schema
`{"version":1,"vault":"<absolute non-UNC path>"}`. This configuration is machine
local and is never installed, committed, or exposed to the provider. A configured
path must already be a real, unlinked directory containing a real `.obsidian/`.
UNC paths and linked roots fail closed. Mapped or otherwise network-backed volumes
cannot be identified reliably and are unsupported.

First capture creates and owns only the vault's `Neura/` subtree. Pre-existing
ambiguous content is retained and rejected rather than adopted, overwritten, or
deleted. Events use bounded, append-only numbered envelopes (`0000.json` through
`1999.json`) with SHA-256 integrity under `Neura/_System/events/`. Writers claim
the next exact slot through exclusive creation, so there is no mutable writer lock;
deterministic Markdown projections are created under
`Neura/Topics/` and `Neura/Learner/`. Projection collisions are never overwritten.
`.obsidian/`, unrelated notes, original materials, and build artifacts are outside
the writer's authority.

Concept publication, actual practice attempts, tutor findings, and structured
teaching preferences trigger capture automatically; no recurring learner command
is required. Raw answers and full transcripts are omitted. Every preference
extracted by the model remains a candidate until two distinct exact learner messages
support the same recognized value. Matching one latest message does not confer
explicit or authoritative provenance, and current instructions always outrank stored
preferences. Future Learn turns receive only recognized preference enums and at
most eight bounded difficulty counters, labelled untrusted data. This is local
retrieval and prompt conditioning, not model training or a mastery system.

Vault capture and workspace recovery have separate failure semantics. A vault
failure produces a warning but does not undo the lesson or exercise. `/learn save`
retains its existing explicit snapshot behavior and remains the recovery source of
truth. Later successful captures reconcile missing immutable Markdown projections
without replacing user-edited files.

## Commands and persistence

- `/learn status`: current lesson, step, attempts, next action, and board path.
- `/learn answer <text or SQL>`: submit to the active exercise.
- `/learn answer-helped <text or SQL>`: record an assisted attempt.
- `/learn hint`, `/learn reveal`: progressive help; assistance stays recorded.
- `/learn explain`, `/learn deeper`, `/learn example`: ask the tutor to continue.
- `/learn save`: explicitly save the current lesson, source text/notes, and attempts.
- `/learn saved`: newest 100 snapshots; `/learn resume <filename>` restores one.
- `/learn reset`: clear in-memory learning state without deleting saved work.

There are no recurring vault commands. Once machine-local configuration exists,
the agent records eligible knowledge automatically through the dedicated Learn
runtime. `learn_progress` preference capture must match the learner's complete
latest interactive message; model-invented feedback is rejected, and no single
model-extracted message can activate a stored preference.

Browser-generated commands include a lesson revision and reject stale boards.
New sessions start without learning content until explicitly resumed. Saved
images are omitted; reimport sources for visual inspection. Restored excerpts
are historical and unverified, visibly labelled on the board. A new citation
requires reimporting the original. The tutor retrieves full resumed lesson data
through `learn_progress`, including diagrams and SQL tables.
Attempt counts and current progress include only the active lesson. Attempts with
other lesson IDs remain separately labelled, unverified history, including after resume.

## Limits and deliberate boundaries

- Node.js 24.15+ is required. Runtime dependencies have a separate exact lockfile;
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
- Vault capture holds at most 2,000 immutable events per managed subtree and fails
  closed when that bound, an integrity check, ownership, or path validation fails.
- Obsidian content is plaintext and may be synced or indexed by Obsidian or its
  plugins independently of Neura. Pattern-based redaction cannot recognize every secret.

## Maintenance and verification

- Follow [development workflow](DEVELOPMENT.md) and repository authorization rules.
- New runtime dependencies need exact pins, source review, documentation, and tests.
- Test valid inputs and denied traversal, links, forged citations, oversized/malformed
  documents, untrusted markup, prohibited execution, mode transitions, and restore.
- Exercise PDF and PPTX ingestion through a rendered lesson and a practical attempt.
- Inspect real browser behavior at desktop and narrow widths; verify keyboard and
  accessibility behavior. Test missing OCR data and legacy-PPT export diagnostics.
- Required checks: `node scripts/verify-harness.mjs`, `node scripts/check-docs.mjs`,
  `git diff --check`, TypeScript, and new Learn-focused suites.
- Update this reference with delivered behavior and precise limitations after checks.

## Delivery evidence

Local verification passed on 2026-09-07: TypeScript, all 17 harness extensions,
documentation/whitespace, 43 material assertions, 61 Windows storage checks, 71 integrated
assertions, workshop evaluator tests, and Learn/Plan desktop/mobile browser scans.
Both dependency graphs reported zero known vulnerabilities; all 31 installed
Learn runtime packages had verified registry signatures (13 attestations).
Independent review findings were fixed and rechecked. Final head `c66c88c` passed
[Windows/Linux CI](https://github.com/Rajveerx11/neura/actions/runs/34101891018)
and Greptile review (5/5, no actionable findings), then merged as `d3e77c6`.
This evidence does not claim a live installation or release.

- `verify-harness.mjs`: 17 isolated suites, real Pi loader, all 18 extensions, mode/provider boundaries,
  private reads/ADS/hardlinks, background hooks, restore, and existing-mode regressions.
- `verify-learn-materials.mjs`: real synthetic PDF/PPTX/OCR and malformed-input tests.
- `verify-learn-workshop.mjs`: diagram validation, escaping, exercise grading, SQL
  denial/resource limits, and numeric edge cases.
- `verify-learn-storage.mjs`: real filesystem link/open interleavings, no content
  disclosure through tested swaps, and static hardlink/path denials.
- `verify-learn-vault.mjs`: opt-in configuration, owned subtree, numbered-envelope
  integrity, structured-event redaction, cross-process initialization, ordinary and
  limit contention, gap rejection, safe Markdown, repeated-evidence preferences,
  bounded retrieval, and denied UNC, linked, relative, unowned, malformed, and oversized inputs.
- `verify-learn.mjs`: actual tools from PDF/PPTX import through cited lesson, attempt,
  SQL, explicit save/resume, forged/stale answers, and saved-input limits.
- `verify-learn-browser.mjs`: desktop/mobile Edge, keyboard interactions, functional
  controls, CSP and no-network assertions, and axe accessibility scans.
- Independent reviews cross-checked components authored in separate agent
  worktrees. Valid findings received fixes and regression coverage before merge.

## Inspiration

https://github.com/amosblomqvist/learn — adopt connected concepts, adaptive teaching,
quizzes, and useful visuals. Build original Neura integration; avoid copying a
personal tutor's rigid assessment or treating all subjects as unconditional truths.

# Learn Mode

The active Mastra Learn service teaches through local documents, visual boards
and practical exercises. Updated 2026-11-07, including the continuity/vault
hardening in #153. Development/testing uses synthetic, non-sensitive materials;
[distribution and production gates](STATUS.md) remain open.

## Start a lesson

Launch Neura in a disposable workspace with a configured provider, then enter:

```text
/mode learn
Teach database joins using materials/joins.pdf. Show one diagram and an example, then give me an exercise.
```

Use an ordinary workspace PDF/PPTX that you created for testing. The tutor imports
it before citing page/slide excerpts, publishes an HTML board and waits for your
answer. Lessons use short bullets, small flow/ER/sequence diagrams and examples.
Progressive hints are available. Open-ended work receives discussion rather than an automatic grade.

Open the returned local HTML path. Browser controls copy revision-bound commands. Submit them in the terminal. There is **no automatic browser synchronization**.
A command from an old lesson revision is rejected. Worked answers are visible
in board source, so boards support self-study rather than examination security.

## Commands and persistence

| Command | Result |
| --- | --- |
| `/learn status` | Current lesson, progress, next action and board path |
| `/learn answer <text or SQL>` | Submit the learner's actual answer |
| `/learn answer-helped <text or SQL>` | Record an assisted attempt |
| `/learn hint`, `/learn reveal` | Progressive help with assistance recorded |
| `/learn explain`, `/learn deeper`, `/learn example` | Ask the tutor to continue |
| `/learn save` | Explicitly save lesson state and progress |
| `/learn saved` | List up to 100 recent snapshots |
| `/learn resume <filename>` | Explicitly restore a saved snapshot |
| `/learn reset` | Clear current in-memory learning state without deleting saves |

Snapshots restore lesson content, diagrams, attempts, next hint, assistance,
tutor notes and next step. Images are omitted. Restored excerpts remain
historical/unverified until the original document is reimported. New citations
require that reimport. Attempts for other lesson IDs remain separately labelled
historical records. Reading, revealing or answering correctly does not prove mastery.

New conversations do not silently load learning content. `/resume <id>` restores
conversation history in Work. Use `/mode learn` and `/learn resume <filename>`
to restore a lesson separately. `--no-history` affects conversations, not Learn
artifacts. There is no automatic progress snapshot save.

## Tools and document boundary

The model receives `learn_material`, `learn_lesson`, `learn_exercise` and
`learn_progress`, plus bounded public-workspace `read`/`ls`. Learn exposes no
generic write/edit, shell, `grep`/`find`, web search, integration or Plan tool.
Publishing a lesson or evaluating an attempt ends the model turn. Model-generated
answers cannot substitute for the learner's actual latest input.

PDF/PPTX import checks captured bytes, source identity and excerpt locations.
These checks validate citation identity, not the truth of the tutor's explanation.
OCR is offline English and can misread formulas or handwriting. Export legacy
`.ppt` and full PowerPoint layouts to PDF/PPTX as described in the
[document runtime review](LEARN_DEPENDENCIES.md). Limits include 12 materials per
session, 25 MiB and 100 pages/slides per file.

Short keyed answers use normalized exact matching. SQL exercises use bounded,
disposable in-memory SQLite with sample tables, no host file/network access and
no `ATTACH` or writes. Grading compares columns and duplicate rows, ignores row
ordering and refuses to grade truncated output. Open-ended work has no automatic score.

## Workspace store

Boards, assets and explicit snapshots live beneath owned `.neura-learning/` with
a marker and Git exclusion. First creation requires native Windows. It refuses
an existing unowned directory. Existing validated stores can be used on POSIX,
but that does not establish a supported Linux installation. Never delete an
unowned directory to bypass the refusal.

Writers use bounded exclusive files and canonical path/handle checks. Unpublished
metadata-only initialization directories can remain after interruption. These
are application controls, not OS isolation against another process running as
the same user. Parser deadlines and heap limits likewise do not sandbox native/WASM code.

## Optional Obsidian capture

Capture is disabled by default. Configure `NEURA_LEARN_VAULT` with an absolute,
local, non-UNC vault path, or put this private file at
`~/.neura/learn-vault.json` (under `NEURA_HOME` when explicitly set):

```json
{"version":1,"vault":"C:\\path\\to\\test-vault"}
```

The directory must already contain a real `.obsidian/`. Linked roots are refused. Mapped/network-backed volumes are unsupported. The active service does not read
the old Pi profile's vault configuration.

Only the vault's marked `Neura/` subtree is writable. Capture adds bounded
concept/practice/tutor/preference events in immutable numbered JSON envelopes
under `Neura/_System/events/`, with new Markdown projections under
`Neura/Topics/` and `Neura/Learner/`. It omits raw answers and full transcripts.
User-edited or ambiguous files are preserved rather than overwritten. The store
holds at most 2,000 events. Integrity hashes detect ordinary edits, not a malicious
same-user rewrite. Content is plaintext. Obsidian or its plugins may sync it independently.

Recognized teaching preferences require evidence from two distinct exact learner
messages before affecting later prompts. Profiles remain bounded, untrusted data
and cannot widen policy. This is prompt conditioning, not model training.
Vault metadata caps topics at 120 characters without shortening lesson titles
accepted up to 160 characters. Vault validation and event formats are unchanged.

A current-session vault failure warns while learning continues. Stale operations
cannot publish state or warnings into a later session. A completed disk/vault write
can remain after cancellation. There is no transaction across both stores.
`/learn save` remains the explicit recovery source.

## Implementation and checks

`src/learn.ts` and `src/learn-state.ts` own active service/session behavior. Shared
`agent/neura/learn-*` modules own parsing, rendering, exercises, file/snapshot handling
and vault storage. The retained Pi extension is not loaded by Mastra.

```powershell
node scripts/verify-harness.mjs --suite learn
npm run test:learn
npm run test:browser:learn
```

The active suite includes fresh-process recovery, actual-answer provenance,
configured-vault title bounds, historical citations and delayed-I/O state fences.
Shared suites retain parser attacks, OCR, SQL, storage races and vault integrity.
Browser checks cover keyboard, narrow layouts, CSP and accessibility in Edge.
See [dated evidence](MASTRA_V1.md#learn-acceptance). These checks do not close all
of #123 or establish production readiness.

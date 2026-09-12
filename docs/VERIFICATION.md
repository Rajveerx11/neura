# Verification

The current verifier uses 17 isolated suites and the checkout's pinned Pi loader.
It includes Work/Learn boundaries, document and exercise behavior, and content-bound
proof receipts. The original modular refactor closed
[#27](https://github.com/Rajveerx11/neura/issues/27); Learn expanded it in
[PR #44](https://github.com/Rajveerx11/neura/pull/44).

## Commands and isolation

Run `npm ci --ignore-scripts` and `npm ci --prefix agent/neura --ignore-scripts`, then `npm test` or
`node scripts/verify-harness.mjs`. No globally installed Pi is needed. Integration
suites validate installed package versions against `package.json` and the runtime
contract, then load all 17 extensions with that checkout's real Pi loader.

Each suite starts in a separate process with a temporary home, synthetic approval
storage, no provider credentials, and isolated Git configuration. Tests neither
install into the user's harness nor call a model/provider. The installer suite
executes extracted installer comparison functions against synthetic files; the
existing Windows CI installation/drift rehearsal remains separate.

| Independent command | Coverage |
|---|---|
| `npm run test:unit` | Runtime identity, health states, bounded MCP/provider initialization, cancellation, redaction, suite selection, local Pi pin failures |
| `npm run test:state-machine` | WORK default, transitions, persistence, provider payloads |
| `npm run test:integration` | Real Pi extension registration, Gmail mediation, presets |
| `npm run test:ui` | Logo, cockpit, widths, line caps, contrast, transcript affordances |
| `npm run test:installer` | Installer contracts and real text/binary drift functions |
| `npm run test:sandbox` | Namespace/environment argument contracts and linked-workspace denial |
| `npm run test:policy` | Positive/negative Plan paths, junctions, shell and Git boundaries |
| `npm run test:plan` | Plan publication, restart, collisions, failed turns, ownership |
| `npm run test:approvals` | Guardrail mediation, state-bound one-use grants, expiry, fail-closed audit |
| `npm run test:approval-storage` | Six concurrent writers, short writes, partial tails, corruption, crash lock |
| `npm run test:proof` | Content fingerprints, bounds, cancellation, lifecycle, full/quick/incremental receipts |
| `npm run test:fuzz` | Fixed seed `0x27c0ffee`: 96 generated path cases and 96 shell mutations |
| `npm run test:learn` | Learn mode/private-read boundaries, PDF/PPTX/OCR, SQL/diagrams, storage races, end-to-end progress, and browser behavior |

`npm run test:accessibility` is the real Plan Edge/axe browser suite.
`node scripts/tests/learn-browser.mjs` runs Learn's isolated browser checks.
Learn's five nonbrowser suites also run in `npm test`; its isolated browser wrapper
runs separately in CI. Browser tools require Edge on the tested Windows platform.
`npm run verify:sandbox` remains the independent live WSL2/bubblewrap replay;
contract tests alone do not establish OS isolation. CI also runs portable proof,
approval-storage, sandbox, and Learn storage contracts on Linux, including FIFO and executable-bit
regressions that Windows cannot exercise.

## Changed-file checks and receipts

`npm run test:changed` selects suites from tracked changes against HEAD and
nonignored untracked files. Shared/unknown code selects every suite. Documentation
changes alone select none; documentation checks still run separately. Selection
never turns a changed filename into a command.

The runner writes a bounded, atomic report to the ignored
`.proofofwork/neura-checks.json`. It contains suite names/results, time, and the
workspace fingerprint. Changes during the run mark the report unavailable and
fail the command. It contains no file bodies or test output.

During interactive work, `check-gate.ts` compares content fingerprints before and
after a turn. Untracked content-only changes, nested new files, binary edits,
index changes, and executable-mode changes trigger the quick proof scan.
The quick scan retains `--no-tests`; full `/ship` always requests actual tests.

Quick/full results become versioned `neura-verification` session entries. Full
receipts include current/stale quick evidence and, when valid, the incremental
suite report. Workspace reports are explicitly untrusted metadata: they cannot
skip full proof or turn a failed full verdict into PASS. Session replacement
cancels the active check and discards late completion. A workspace mutation during
proof, malformed output, timeout, cancellation, or failed snapshot cannot earn PASS.

Snapshots cap file count at 50,000, aggregate bytes at 64 MiB, Git output at 8 MiB,
and capture time at 10 seconds. They reject selected links, special files,
conflicted index entries, and submodules rather than claiming complete coverage.
Ignored files remain excluded unless already tracked. These fingerprints do not
claim to solve all concurrent filesystem races or Plan confidentiality (#35).

## Approval failures and remaining gates

Work proof executes only inside the existing network-disabled WSL2 bubblewrap
environment, with its runner and packages already available. Unavailable sandbox
execution reports unavailable, without host fallback. YOLO retains bounded host
proof. Both modes block mode changes during capture and verification. Learn, Plan,
and Human Away do not run this proof hook.

Approval writers hold a cross-process directory lock across read, deduplication,
and append. Short writes retry; completed appends are flushed. Lock waits stop
after ten seconds. Readers reject malformed JSON or a broken hash chain.
Windows can return `EPERM` during directory-lock contention. Acquisition retries
that error within the same deadline; permanent denial still fails without audit
mutation, and unrelated errors remain immediate. No lock is stolen or bypassed.

A crashed writer can leave a lock or incomplete tail. Both fail closed; the test
suite proves rejection, not automatic recovery. Before manually repairing a lock,
stop every Neura process and validate the audit. Never discard an invalid tail to
manufacture a valid approval. Transactional recovery, authenticated tamper evidence,
retention, and stronger remote binding remain issue #33. Runner dependency trust
remains #22; strict TypeScript remains #26; Human Away remains preview-only.

## Migration and rollback

The verification refactor changes no runtime dependency or existing approval schema.
Learn separately adds the pinned document runtime described in
[LEARN_DEPENDENCIES.md](LEARN_DEPENDENCIES.md). Existing valid audits
remain readable. New session receipt entries are additive. Roll back the scoped
source commit and, only with owner authorization, regenerate the live install;
older versions ignore the new receipt entries and ignored incremental report.
Do not roll back while approval writers are active, because older code does not
honor the writer lock. No live installation is required to run these suites.

Health state and probe results are diagnostic only; no persisted schema changes.
The runtime contract adds the existing Neura package version for display and
drift evidence. Roll back the health extension, runtime-contract field, and
tests together, then regenerate the live install only with owner authorization.

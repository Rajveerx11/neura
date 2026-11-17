# Verification

Updated 2026-11-17. The owner requested removal of repository test files,
fixtures and test-only runners. Runtime regression coverage is unavailable.
Work review and manual proof remain separate checks and cannot establish
production readiness or authorize publication.

## Repository checks

```powershell
npm run verify
git diff --check
```

`verify` checks the test-file policy, strict active-source types, dependency
boundaries and current documentation. `node scripts/verify-harness.mjs` checks
only the file policy. It rejects former suite arguments. `npm test` fails with
an explicit unavailable message, so no empty test run can appear to pass.

Both required CI jobs, `harness` and `portable-proof`, run repository checks.
Their success is not runtime, browser, sandbox or secret-scanner regression evidence.
CodeQL, dependency review, dependency/signature audits, complete-history secret
scanning and the disposable development-launcher check remain configured.

Separate checks remain available:

| Command | Scope |
| --- | --- |
| `npm run audit:dependencies` | Both locked dependency graphs; requires registry access |
| `npm run audit:signatures` | Registry signatures for both installed graphs |
| `powershell -NoProfile -File .\scripts\verify-secrets.ps1` | Complete-history secret scan with redacted output |
| `powershell -NoProfile -File .\install.ps1 -Check` | Read-only launcher drift check; no install authorization |
| `node scripts/check-parity-matrix.mjs` | Frozen inventory and historical evidence paths; runs no tests |
| `npm run verify:release` | Licence gate only; other release gates remain open |

Historical regression sources are preserved at
`1d4964a4f879fafc32d6fb74a0e575c7c77c0e5d`. Full Git history is required to inspect
them. The parity matrix validates evidence paths against that revision,
without certifying that the tests passed or that current behavior matches them.

## Work review

Automatic review is on by default. `/workflow on|off` controls it. `/review`
requests review of changes since the original task baseline and `/review status`
checks the last receipt. A committed Git root within snapshot bounds is required.
Docs-only changes are skipped by path-based risk routing. A turn with no changes
ends silently. Missing baseline means review is unavailable, not a clean review.

The reviewer is a fresh model instance with code-enforced read-only tools. It
defaults to the builder model, labelled same-family. Set a different provider
through `/reviewer PROVIDER MODEL [URL]` or the reviewer launch flags for
cross-family independence. The controller marks blockers and major findings with
non-low confidence as must-fix. The builder may repair them for up to three rounds.

Review receipts bind to candidate fingerprints and become stale after later edits.
They remain session-local. Work's 60-step limit preserves an unfinished task's
starting baseline for continuation and explicit saved-session resume, and skips premature review.
If HEAD moved from the task base, review remains unavailable because the reviewer
diffs current HEAD. Unknown or oversized original snapshots cannot be replaced
with current state. Interrupted outcomes require inspection and `/reconcile` before
another task turn. The command restores no authority or crash lock. Reviewers keep an
eight-step bound. Outcomes are `READY FOR YOUR APPROVAL`, `BLOCKED` or
`Review skipped`. They never commit, push or merge. Recorded live same-family
runs are in [Mastra evidence](MASTRA_V1.md#real-project-work-2026-11-06). They do
not establish live cross-family or must-fix repair acceptance.

## Manual proof and receipts

In Work, `/verify quick` requests pinned PoW `0.2.0` through the network-disabled
WSL proof sandbox after exact interactive approval. It requires the exact Git
root with committed HEAD, trusted uv/CPython paths and the reviewed offline
wheel closure. No automatic download or host fallback occurs. A headless request
cannot approve execution and fails when verification is unavailable.

Receipts record before/after fingerprints of HEAD/index, tracked bytes/modes and
nonignored untracked files. Ignored files are outside this fingerprint.
`/verify status` loads the selected saved conversation's receipt and recalculates
currency against current workspace bytes. An edit makes the receipt stale. Missing
snapshots cannot make it current. With `--no-history`, receipts stay in memory.

Each saved conversation has at most one versioned receipt, bounded to 4 KiB, under
`NEURA_HOME/sessions/<workspace-digest>/verification/<session-uuid>.json`. It contains
fixed outcome metadata and candidate/base digests. Identifiers and completion time
are also recorded.
There are no raw runner payloads, transcripts, paths or secrets. Session/workspace
bindings and schema are checked on every load. Storage reuses canonical directory
checks and single-writer locks, refuses links/hardlinks, bounds reads and replaces
the receipt atomically after syncing a temporary file. Cancellation or session
replacement before publication discards the pending receipt. Failed publication
preserves the previous one. Crash locks fail closed for manual reconciliation.

Receipts always retain `verified:false` and `testsRun:false`. Stored bytes are
unauthenticated metadata: schema checks cannot detect every valid-looking edit.
They are not signed attestation, automatic approval or delivery authority. Workspace
reports are never imported, and receipts are separate from conversation history.
Audit files use disposable sandbox `/tmp`, not the candidate workspace.

Bare `/verify` and `/verify full` report `unavailable`: PoW `0.2.0` lacks trusted
required-suite/candidate evidence. Detector-only PASS is not test success or
engineering completion. Full proof remains [#163](https://github.com/Rajveerx11/neura/issues/163).
This slice adds durable receipt and original-task-base metadata. It closes neither
#163 nor #28. Checkpoints, undo, crash-lock recovery, budget continuity, ignored-file
coverage, trusted full evidence and delivery enforcement remain open. Learn cannot
run proof. `/ship` is unavailable.

## Failures and historical evidence

Report the command, source commit, actual exit/result and any missing prerequisite.
Never relabel a skipped, partial or failed check as passing. Crash locks and
invalid state fail closed. Do not steal locks, repair an audit tail or delete
private state to force a pass. Inspect uncertain effects before retrying.

Older evidence belongs to its recorded revision. Legacy regression runners were
removed. Historical evidence is not permission to restore Pi or claim a current pass.
See [status](STATUS.md), [implementation evidence](MASTRA_V1.md) and
[release policy](RELEASING.md).

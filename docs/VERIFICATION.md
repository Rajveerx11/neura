# Verification

Updated 2026-11-08 for the active Mastra application through `efdbde3`.
Repository tests, Work review and manual proof are separate checks. None authorizes publication or establishes
production readiness. Historical Pi tests are retained separately.

## Repository checks

Install both locked graphs with scripts disabled, then run:

```powershell
npm run verify
git diff --check
```

`verify` runs strict active-source types, Pi-free/package-closure checks,
`node scripts/verify-harness.mjs` and registered documentation checks. The active
runner defines 23 suites, using synthetic stores/models and isolated test
processes. It does not require credentials, install into a live profile or prove
live provider access. Default sandbox tests check contracts and fail-closed
behavior without requiring successful Work execution on an unconfigured host.

| Suites | Scope |
| --- | --- |
| `runtime`, `auth` | Mastra dispatch, schemas, bounded turns, serialized effects, cancellation and synthetic subscription transport/storage |
| `cli`, `terminal-ui` | Real CLI with synthetic providers, commands, history, approvals, quiet output, widths and fallbacks |
| `acp` | ACP negotiation, isolated discovery, retained Work/Learn state, exact-action permissions, tool cards, cancellation and disconnect cleanup |
| `learn`, `agent-learn` | Active Learn tools, provenance, explicit recovery, title bounds and stale async operations |
| `work-tools`, `review`, `workflow` | Workspace policy/search/mutations, read-only review, candidate currency and bounded repair |
| `yolo` | Host tools with no policy, network, process-tree kill, truncation, stale-call fence, startup flags, confirmed entry and unchanged Work/Learn policy |
| `verification` | Work-only manual proof admission, fingerprints and unavailable/full-proof boundaries |
| `installer` | Development launcher ownership, path refusals and preservation, including reversible retirement contracts |
| `parity-matrix`, `dependency-gate` | Frozen-baseline inventory and package/license closure rules |
| `learn-materials`, `learn-workshop`, `learn-storage`, `learn-vault` | Shared parser/OCR, exercises, store and vault integrity/race regressions |
| `sandbox`, `process-contract`, `workspace-read`, `ci-contract` | Isolation arguments, process cancellation, canonical traversal and CI gates |

Run a focused suite with `node scripts/verify-harness.mjs --suite work-tools`.
Unknown names fail. Definitions live in `scripts/verify-harness.mjs`, not the
historical `scripts/test-suites.mjs`. No active `test:changed`, `test:release`,
`test:accessibility` or `check:pi-latest` npm command exists.

The parity suite reads baseline commit `3ebaac07c8320125bcc32478b5aa3865746a997c`.
Use full Git history. Shallow clones need `git fetch --unshallow` first.

## Separate acceptance checks

| Command | Prerequisite and meaning |
| --- | --- |
| `npm run test:browser:learn` | Real Edge. Standalone Learn boards, narrow/desktop interaction, keyboard, axe, CSP and terminal handoff |
| `npm run test:v1:work-sandbox` | Native Windows, WSL2, selected distro and bubblewrap. Actual Work commands, exact file output and protected-path regressions. Fails if unavailable |
| `npm run verify:sandbox` | Independent real WSL isolation replay. Not replaced by synthetic command contracts |
| `npm run audit:dependencies` | Vulnerability audit of both locked graphs. Requires registry access |
| `npm run audit:signatures` | Registry signatures/attestations for both installed graphs |
| `powershell -NoProfile -File .\scripts\verify-secrets.ps1` | Complete-history scan. Requires the reviewed scanner and history |
| `powershell -NoProfile -File .\scripts\verify-secrets.tests.ps1` | Secret-scanner and synthetic download-retry regressions |
| `powershell -NoProfile -File .\scripts\download-verified.ps1 -Uri URL -OutFile PATH -Sha256 HASH` | CI's pinned-download helper. A cached file gets one hash check and no download. A missing file gets at most three attempts, only for HTTP 502/503/504 or transient network failures. The hash is checked once, after downloading, so a mismatch fails immediately |
| `powershell -NoProfile -File .\install.ps1 -Check` | Read-only development-launcher drift check. No permission to install |
| `npm run verify:release` | Expected refusal while Mastra EE/distribution approval remains unresolved |

Windows CI keeps the required `harness` job. Ubuntu `portable-proof` runs portable
contracts, including Work/review/workflow regressions. Hosted PR checks do not
establish configured-host WSL acceptance. Required CI, CodeQL and dependency
audits must be evaluated on the actual proposed commit.

## Work review

Automatic review is on by default. `/workflow on|off` controls it. `/review`
requests review of changes since the session baseline and `/review status`
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
starting baseline for continuation and skips premature review. Reviewers keep an
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
`/verify status` rechecks currency. Receipts are process/session metadata with
`verified:false`. They are not signed, durable, imported from workspace reports,
saved in conversation history or used to grant delivery authority. Audit files
use disposable sandbox `/tmp`, not the candidate workspace.

Bare `/verify` and `/verify full` report `unavailable`: PoW `0.2.0` lacks trusted
required-suite/candidate evidence. Detector-only PASS is not test success or
engineering completion. Full proof remains [#91](https://github.com/Rajveerx11/neura/issues/91).
Durable receipts, original-task-base binding, ignored-file coverage and delivery
enforcement remain open under #28/#91. Learn cannot run proof. `/ship` is unavailable.

## Failures and historical evidence

Report the command, source commit, actual exit/result and any missing prerequisite.
Never relabel a skipped, partial or failed check as passing. Crash locks and
invalid state fail closed. Do not steal locks, repair an audit tail or delete
private state to force a pass. Inspect uncertain effects before retrying.

Older evidence belongs to its recorded revision. `scripts/verify-legacy-harness.mjs`
and `scripts/check-legacy-docs.mjs` retain the Pi baseline and may fail without its
retired dependencies. They are not current Mastra checks or permission to restore Pi.
See [status](STATUS.md), [implementation evidence](MASTRA_V1.md) and
[release policy](RELEASING.md).

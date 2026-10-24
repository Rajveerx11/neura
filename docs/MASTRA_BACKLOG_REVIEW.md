# Mastra migration: existing backlog review

Reviewed 2026-10-23 against `3ebaac07c8320125bcc32478b5aa3865746a997c`.
Repository: <https://github.com/Rajveerx11/neura>; source branch: `main`.
Planning branch: `migration/mastra-20261023`, in an isolated source worktree.

## Scope and decision

All 19 open issues were reviewed; none was skipped. There are no open PRs.
All issues remain open. No issue or PR was closed, merged, or declared fixed.
No application code, dependency installation, or runtime execution was needed for this review.
The original checkout's modified `docs/README.md` and untracked
`docs/MASTRA_MIGRATION_REFERENCE.md` are user work and remain untouched.

The audit covered issue descriptions, all paginated comments and timeline cross-references.
A fresh-context reviewer inspected relevant historical PR descriptions, changed-file lists,
acceptance-related diffs, reviews/comments and existing CI. This was not a new full-source
security review of every historical PR file. Source observations were checked against the
migration reference by a separate read-only scout and the parent. No private state was read.

## Dispositions and carried obligations

“Migration” means retain requirements through the new adapters. “Independent” means the
unfinished hardening, evaluation or optimization keeps its existing issue as canonical owner.
Historical merged slices establish progress, not completion. Links below point to the full
acceptance criteria, which remain authoritative.

| Existing item | Disposition | Evidence and obligation |
|---|---|---|
| [#21](https://github.com/Rajveerx11/neura/issues/21) | Migration + independent release blocker; retain | PR #82 expressly excludes completion. The reopening comment records non-atomic settings/launcher/Terminal activation, host-path swaps, unreceipted installation and missing clean-Windows rehearsal. Reuse managed staging/receipts/recovery; retain full atomic-install and rollback acceptance. |
| [#24](https://github.com/Rajveerx11/neura/issues/24) | Migration + independent P0; retain | `agent/neura/human-away-sandbox.ts:208–210` still binds the selected workspace writable. Preserve WSL containment but retain isolated candidates, resource bounds, validated promotion and descendant cancellation. Human Away remains preview. |
| [#26](https://github.com/Rajveerx11/neura/issues/26) | Independent, applies to migration; retain | `tsconfig.json:8–9` disables strictness. PR #98's shared contracts do not finish strict migration. Establish a fresh diagnostic baseline rather than reuse historical error counts. |
| [#28](https://github.com/Rajveerx11/neura/issues/28) | Migration + independent recovery; retain | PR #55 added raw checkpoints; `agent/extensions/checkpoint.ts:313–315` removes them at shutdown. Preserve undo but retain durable task identity, interrupted-action reconciliation, single-writer recovery and no duplicate effects. |
| [#29](https://github.com/Rajveerx11/neura/issues/29) | Migration + independent security; retain | Restricted MCP gating is partial progress. `october-bus.ts` lacks authenticated bounded transport; memory is raw prompt text. Retain provenance and scoped/redacted ingress/egress. Cancellation and memory editing/forgetting controls remain required. |
| [#30](https://github.com/Rajveerx11/neura/issues/30) | Independent evaluation; retain | No reproducible Neura autonomy result is supplied. Preserve PoW adapter ownership, sanitized task classes, held-out outcomes, private metrics and all retries. Upstream results are not Neura results. |
| [#31](https://github.com/Rajveerx11/neura/issues/31) | Independent roadmap; retain | Child gates remain unfinished. Reconcile stale checkboxes for closed #25/#35/#38/#59 without implying production readiness. Link the migration epic; keep this roadmap's authority/evidence requirements. |
| [#33](https://github.com/Rajveerx11/neura/issues/33) | Migration + independent security; retain | PR #43 supplied locking/fsync and rejection. `approval-store.ts:84–85,139–143,192,223–232` retains unkeyed hashes, crash locks, short/prefix IDs and incomplete workspace resolution. Retain authenticated integrity, recovery, destination binding and retention. |
| [#34](https://github.com/Rajveerx11/neura/issues/34) | Migration + independent security; retain | `gmail-guardrail.ts:32–42,51–52` summarizes limited fields and bypasses YOLO prompts. Complete mutation intent/body/attachments and integration-only credentials remain unproven. Do not imply restricted modes expose Gmail. |
| [#57](https://github.com/Rajveerx11/neura/issues/57) | Migration + independent UX; retain | PR #94 preserves detector-only labels. Working/repairing/escalated/verified headless states, exact-candidate evidence and budget/cancellation behavior remain required. |
| [#58](https://github.com/Rajveerx11/neura/issues/58) | Migration + independent UX; retain | Existing ten-line approval display is not full focused-exception UX. Retain deny-first keyboard behavior, exact scope/expiry/fallback, stale/error/timeout denial and one useful escalation. |
| [#60](https://github.com/Rajveerx11/neura/issues/60) | Independent measured optimization; retain | Cost cache exists, but `cockpit.ts:189–196` and `neura.ts:140–142,157–160` retain duplicate subscriptions/notices work. Preserve safety updates and measure render/subscription disposal before optimizing. |
| [#61](https://github.com/Rajveerx11/neura/issues/61) | Migration baseline + independent performance; retain | The Pi comparison is still useful as a before-migration reference, not obsolete. Add old/new fixed-fixture comparisons, median/tail timings, memory and settling budgets without private payloads. |
| [#62](https://github.com/Rajveerx11/neura/issues/62) | Migration design + independent optimization; retain | Restricted MCP lazy behavior is only a slice. Measure optional imports/prompt composition; policy stays eager. First-use/cancellation failures must not activate tools or credentials. |
| [#63](https://github.com/Rajveerx11/neura/issues/63) | Independent optional optimization; retain | Content hashing remains the safe baseline. Require measured gain plus full-hash/unavailable fallback; metadata/watchers cannot authorize receipt reuse. |
| [#64](https://github.com/Rajveerx11/neura/issues/64) | Independent investigation; retain | Worker reuse is not implemented or necessary for parity. Require material measured benefit and cold/reused isolation equivalence; cold execution remains fallback. |
| [#91](https://github.com/Rajveerx11/neura/issues/91) | Migration + independent delivery blocker; retain | `verification.ts:139–155` rejects legacy full PASS. PR #94 explicitly excludes closure. Trusted configured suites, whole-candidate coverage, reviewed PoW artifacts and actual passing/failing commands remain required. |
| [#92](https://github.com/Rajveerx11/neura/issues/92) | Independent task-authority design; retain | PR #98 adds capability mechanics, not authority. Retain owner-controlled task/base/policy/budget/destination binding and exception-only escalation. Adapt its Pi-specific wording; do not grant permissions through migration. |
| [#93](https://github.com/Rajveerx11/neura/issues/93) | Independent orchestration; retain | Depends on #24/#28/#91/#92. Retain isolated single-writer work, independent exact-diff review, bounded repair/reverification and local-bundle-first delivery. Replace its “Keep Pi as the worker” implementation assumption with the selected Mastra target; no autonomous shipping is authorized. |

## Historical PRs inspected

| PR | Existing CI and useful work | Acceptance limit |
|---|---|---|
| [#41](https://github.com/Rajveerx11/neura/pull/41) | [33777817919](https://github.com/Rajveerx11/neura/actions/runs/33777817919), harness passed; deliberate YOLO consent and accessibility | Not completion of #57/#58. |
| [#42](https://github.com/Rajveerx11/neura/pull/42) | [33790459063](https://github.com/Rajveerx11/neura/actions/runs/33790459063), harness passed; Work default and WSL boundary | Writable workspace is not transactional #24 isolation. |
| [#43](https://github.com/Rajveerx11/neura/pull/43) | [34048341901](https://github.com/Rajveerx11/neura/actions/runs/34048341901), harness/portable-proof passed; modular tests, fingerprints, locking | Leaves recovery and keyed integrity to #33. |
| [#45](https://github.com/Rajveerx11/neura/pull/45) | [34450598864](https://github.com/Rajveerx11/neura/actions/runs/34450598864), harness passed, portable-proof failed in approval-storage; health/probe safeguards | Historical failure, not proof of a current-source regression. Greptile success is not all-green CI. |
| [#55](https://github.com/Rajveerx11/neura/pull/55) | [34945430051](https://github.com/Rajveerx11/neura/actions/runs/34945430051), required jobs passed; executable containment/raw-copy checkpoint hardening | Incremental review of two installer files is not whole-feature acceptance. Preserve wheelhouse/canonicalization concerns. |
| [#82](https://github.com/Rajveerx11/neura/pull/82) | [36253269500](https://github.com/Rajveerx11/neura/actions/runs/36253269500), required CI passed; managed install recovery | Explicitly does not close #21. |
| [#88](https://github.com/Rajveerx11/neura/pull/88) | [37484129703](https://github.com/Rajveerx11/neura/actions/runs/37484129703), required CI passed; compatibility/prerequisites | Hosted review skipped; CLI review description is separate evidence. Does not complete installation. |
| [#94](https://github.com/Rajveerx11/neura/pull/94) | [37344657452](https://github.com/Rajveerx11/neura/actions/runs/37344657452), required CI passed; fail-closed legacy proof | Explicitly closes neither #91 nor #31; hosted review requests were rate-limited. |
| [#98](https://github.com/Rajveerx11/neura/pull/98) | [37957750226](https://github.com/Rajveerx11/neura/actions/runs/37957750226), required CI passed; shared capability/process contracts | Excludes task authority/recovery and physical descendant-termination guarantees. |

The baseline commit's [Required CI](https://github.com/Rajveerx11/neura/actions/runs/39394958493)
passed historically. Its later scheduled [latest-pi check](https://github.com/Rajveerx11/neura/actions/runs/39953146644)
failed because npm stable Pi is `1.4.0` while the reviewed contract is `1.3.0`.
The existing runtime has a current compatibility defect, not proven `1.4.0` support.
The dependency-selection issue owns this obligation until Pi retirement. Keep the failure visible.
Do not disable the check while the existing Pi runtime remains supported. No CI was rerun during planning.

## Source/reference verification

HEAD, candidate version, all 19 extension filenames and exact Pi `1.3.0` root pins match the
local migration reference. The six Learn direct pins match their separate lock graph.
At inventory time the reference was untracked and GitHub issues cited its headings plus
public baseline source permalinks. This documentation change includes the
[reference](MASTRA_MIGRATION_REFERENCE.md) without changing its audited baseline.

Source wins on these discrepancies:

- `cockpit.ts:260–261` settles on idle `agent_settled`, not `agent_end`.
- `checkpoint.ts:126,187` stores raw temporary copies, not Git objects.
- `approval-store.ts:143` uses ten-second lock contention, despite SECURITY's two-second wording.
- Architecture's extension table omits the Herdr bridge; source has 19 extensions.
- Current UI palette is logo blue; DESIGN's copper wording is historical.
- Plan publication (`plan-artifact.ts:293–350`) lacks a post-await session fence.
  Learn (`learn.ts:116–132,190–195,229–241`) has incomplete vault/profile fencing.
- Work's awaited confirmation is not freshly rebound like Human Away's exact retry.
- External Pi/package command catalogs, data schemas and provider quirks are not fully
  specified by the reference. Their inventory is a migration gate, not claimed parity.

## Review status

OCR workspace preview accounted for both original changed Markdown files as unsupported
source-review exclusions: zero reviewable changed source files, two explicitly excluded.
Rules were fetched for inspected source. Separate reviewers reported the acceptance gaps above;
no fixes or post-fix clean review are claimed. No tests ran in this phase.

Prose lint and manual editing apply to this report. The required different-model writing
cleanse failed; no successful second-model writing pass is claimed.

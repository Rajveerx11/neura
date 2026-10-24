# Mastra migration progress

Initial planning checkpoint: 2026-10-23, before documentation submission.
This records the checks run at that checkpoint, not later PR status.
**The migration is not implemented.**

## Completed planning

- Reviewed all 19 original open issues, including comments and linked historical work. None was closed.
- Confirmed no open PR. No PR was merged or closed.
- Created [epic #113](https://github.com/Rajveerx11/neura/issues/113) and
  [16 concrete implementation issues](MASTRA_MIGRATION_ISSUES.md).
- Verified all child bodies, dependency links and 19 original-issue backlink comments through GitHub.
- Independent review checked feature/blocker coverage and the issue dependency graph.
  Follow-up corrections separated auth-free fixture work from real-account evidence,
  made terminal shutdown depend on the process contract, and corrected the configured
  extension-package count to six.
- Kept the original checkout and its two user-authored documentation changes untouched.

Planning evidence: [backlog dispositions](MASTRA_BACKLOG_REVIEW.md) and
[complete issue specifications](MASTRA_MIGRATION_PLAN.md).

## Source isolation and authority

Source baseline: `3ebaac07c8320125bcc32478b5aa3865746a997c`.
Branch: `migration/mastra-20261023`.
Worktree: isolated from the owner's original checkout.
Only documentation had been added at this checkpoint. No application source or dependency manifest changed.
No dependencies were installed. No live harness, credential store, memory, approval log,
session history or real vault was read or changed. No commit or push had occurred at this
checkpoint. Later documentation submission does not authorize a tag, release, deployment
or live installation.

GitHub writes were limited to authorized issue creation, issue-body planning corrections
and comments retaining old requirements. All 19 original issues remain open.

## Phase 3 groundwork: baseline and package review

[#114](https://github.com/Rajveerx11/neura/issues/114) and
[#115](https://github.com/Rajveerx11/neura/issues/115) remain open prerequisites.
No headless Mastra execution or resumed-action proof has run.

Downloaded public npm artifacts to an OS-temporary research directory, not an installed
runtime. SHA-512 bytes matched each registry integrity value:

| Artifact | Compressed bytes | State |
|---|---:|---|
| `@mastra/core@1.79.0` | 18,076,735 | Direct manifest, license and selected dispatch/storage/telemetry declarations inspected. Full dependency review pending. |
| `@mastra/code-sdk@1.15.0` | 1,113,308 | Stable auth/provider declarations and selected shipped JavaScript inspected. Not approved or installed. |
| `@earendil-works/pi-coding-agent@1.3.0` | 7,578,261 | Native command/options/resource/session source inventory started. Not a global or local Pi installation. |

Both Mastra release tags resolve to commit
`4c22623ea342a0ce611e15f89f4ab8b377bf7ee8`:
[core tag](https://github.com/mastra-ai/mastra/releases/tag/%40mastra%2Fcore%401.79.0),
[SDK tag](https://github.com/mastra-ai/mastra/releases/tag/%40mastra%2Fcode-sdk%401.15.0).
GitHub reports the annotated tags unsigned. npm metadata provides signature and provenance
references, but cryptographic signature/attestation verification was not performed.
A matching tarball hash is not a complete provenance or security review.

### Findings that constrain package selection

1. The release commit's `mastracode/tui/package.json` is `mastracode@0.48.0` and directly
   requires `@earendil-works/pi-tui@0.80.6`. The ready-made terminal is not an acceptable
   unchanged replacement. A guessed `@mastra/tui` registry lookup returned 404.
   The actual upstream manifest, not that guessed package name, is the evidence.
2. `@mastra/code-sdk@1.15.0` exports shipped auth and provider subpaths through its wildcard
   export. Browser/device Codex login, refresh and the subscription transport are real source
   candidates. No login, refresh or model request was tested. AuthStorage defaults and migration
   behavior need explicit Neura-owned paths and synthetic stores before any execution.
3. The SDK declares a broad closure including PostgreSQL, DuckDB, libsql, embeddings,
   browser automation and PostHog. A deep import does not remove those install-time dependencies.
   Minimum-maintenance selection still needs a reviewed decision. Do not add services merely
   because the package includes adapters for them.
4. Core's shipped `LICENSE.md` explicitly excludes content under `ee/` from Apache-2.0.
   Its package-level SPDX field is not sufficient to label every shipped file open-source.
   Source/import/license scope must be resolved before distribution approval.
5. Core's shipped telemetry helper enables telemetry by default unless
   `MASTRA_TELEMETRY_DISABLED` is `1`, `true` or `yes`. The helper can also resolve Git origin
   through an ambient executable. A future entry point must establish privacy settings before
   framework initialization and prove no unwanted network/process effects. No such helper ran.
6. Core exports an in-memory store suitable for synthetic suspend/resume investigation.
   Its existence does not establish persistence, dispatch coverage or crash recovery.

These are source-inspection results, not a selected package bill of materials.
No target dependency closure has yet been approved as Pi-free.

### Upstream baseline inventory started

The exact Pi artifact declares 24 native slash commands, beyond Neura's 15 commands.
The source inventory distinguishes these upstream declarations from proven Neura consumption:

- Configuration/authentication: settings, model, thinking, scoped-models, login, logout, trust.
- Session/context: tree, fork, clone, new, resume, name, session, compact, reload.
- Transfer/help/lifecycle: export, import, share, copy, bug, changelog, hotkeys, quit.

Source anchors: `dist/core/slash-commands.js:2–26`, `dist/cli/args.js:24–261`,
`dist/core/agent-session.d.ts:544–644,713–756,855–905`.
CLI print/text/JSON/RPC, steering versus follow-up queues, resource substitution, image handling,
reasoning/transport settings, branch summaries and session import/export need explicit fixtures.
`/share` can publish externally to a gist or Radius: it is not local export and must require
appropriate authority. No share action was executed.

Six exact extension-package source audits remain: Ollama search, redaction, LSP, subagents,
MCP and context. Native-command consumption mapping and the full public data-format inventory
are not complete. #114 must not be closed from filename/category coverage alone.

## Validation observed

Run after the planning gate, in the isolated worktree with Node `24.19.0`:

| Check | Result |
|---|---|
| `node scripts/verify-harness.mjs` | FAILED: 4/18 suites passed. The other 14 failed to load absent root/Learn dependencies. |
| Sandbox contract | Passed. Not a live WSL/bubblewrap replay. |
| Approval storage | Passed with synthetic concurrent writers and crash/corruption cases. |
| Learn storage | Passed with synthetic stores. |
| Learn vault | Passed with synthetic vaults. No real-vault write. |
| `node scripts/check-docs.mjs` | Passed for the initial four-file planning snapshot: 44 Markdown files, before the reference was copied into this worktree. The reference's 42-file audit was a separate earlier run. |
| `git diff --check` | Passed for tracked changes. A separate whitespace assertion passed for all four untracked documents. |
| Current remote Pi compatibility | FAILED: [run 39953146644](https://github.com/Rajveerx11/neura/actions/runs/39953146644) finds stable `1.4.0` against reviewed `1.3.0`. |

The runtime compatibility failure is owned by #115 while Pi remains supported.
Historical CI success is not a current compatibility claim. No check was bypassed and no Pi was downgraded.
Browser, actual subscription authentication, real WSL isolation, full graph audit/signatures,
clean-host installation and real Mastra dispatch/recovery are unverified.
No TypeScript/JavaScript source changed, so there is no changed-source LSP result to claim.

OCR delegation accounted for the original two modified/untracked Markdown files as unsupported
source-review exclusions. The final worktree preview likewise excluded all four new Markdown
files, with zero reviewable changed source files. Source rules were retrieved for inspected modules.
The final focused manual review checked two documents and explicitly skipped the other two as
outside scope. It confirmed all planning corrections. No post-fix clean code review is claimed.

Markdown previews used Leaf. Prose lint found formatting/list patterns in the technical reports;
manual editing preserved exact source names and reference headings. The different-model writing
cleanse failed. No full automated writing pass is claimed.

## Next dependency

Finish #114's external capability/data catalog and synthetic baseline contracts, then #115's
exact source/license/dependency/telemetry review. Keep the current Pi compatibility defect visible.
Only after those prerequisites pass, implement #116's allowed/denied/stale-resume headless proof
through actual Mastra dispatch. Do not skip those gates to produce a chat demo.

Human Away remains preview. Neura remains experimental and not production-ready.

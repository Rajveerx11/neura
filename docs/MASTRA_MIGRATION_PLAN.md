# Mastra migration issue plan

Planning snapshot: 2026-10-23; source baseline `3ebaac07c8320125bcc32478b5aa3865746a997c`.
See [the completed backlog review](MASTRA_BACKLOG_REVIEW.md),
[published issue links](MASTRA_MIGRATION_ISSUES.md) and the
[implementation reference](MASTRA_MIGRATION_REFERENCE.md). All existing issues stay open.
This is an implementation plan, not a claim that Mastra, OAuth or recovery parity exists.

## Delivery rules

- Open-source distribution, Windows support and minimum maintained framework adapters are required.
- Full target removal includes Pi's direct/transitive libraries, pi-tui and all acquired Pi extensions.
- Reuse Neura policy, renderers, parsers, storage and sandbox; no database/service without a concrete need.
- Keep exact Pi compatibility/pins/checks while the old runtime remains supported; never downgrade the owner's Pi.
- Human Away stays preview. Quick proof stays detector-only; legacy full PASS stays unavailable.
- This plan grants no publishing or deployment authority. The owner separately authorized submitting the completed documentation to main, subject to review and CI. No live installation or release is authorized.
- Source changes use isolated branches. All state/auth tests use synthetic fixtures; actual login/rehearsal needs separate consent.
- Reference section names below identify [the audited migration reference](MASTRA_MIGRATION_REFERENCE.md). Its current-behavior statements are distinct from unimplemented migration requirements.

## Dependency order and ownership

M0 freezes coverage; M1 reviews package choices; M13 defines data contracts. M2 then proves real final dispatch before broader runtime work.
M3 owns session/event semantics. M4 owns auth. M5 owns approvals/reviewer. M6 owns process/WSL adapters. M7 owns undo/proof parity.
M8 and M9 own Plan and Learn. M10 owns terminal presentation. M11 owns acquired developer adapters; M12 owns optional integrations.
M14 owns distribution; M15 is the final evidence gate. Dependencies below are acyclic. Components can be tested incrementally before M15 closure.
No two writers own the same worktree; adapter boundaries and shared-module changes need parent coordination.

Every documented feature is assigned by its section and inventory category below. M0 owns the incomplete external-package/native-command catalog and must finish it before claiming complete parity.
Existing blockers keep their old issue owners. The new issues adapt those contracts, rather than duplicate unfinished hardening.
#93's Pi-worker assumption is superseded by the selected target, but its end-user requirements remain open.

## Feature coverage

| Baseline surface | Owner |
|---|---|
| All 19 extension entries, native Pi/package inventories, command/config/state completeness | M0 |
| Exact graph, licensing, native/WASM/lifecycle/telemetry review, Pi-free closure | M1 |
| Five modes, selected tools, deterministic policy, final/nested/deferred/restored dispatch | M2 |
| Persona/report prompts, loop, session/tree/fork/history/compaction/retries, streaming, machine interfaces, usage events | M3 |
| GPT subscription, Anthropic, local Qwen, login/refresh/restart, entitlements/reasoning/provider switches | M4 |
| Exact one-use approval grants, fresh execution binding, deny-first commands, isolated Headmaster | M5 |
| Windows canonical containment, WSL2/bubblewrap, pinned offline runtime, cancellation | M6 |
| YOLO raw checkpoints/undo/rollback, proof fingerprints/receipts, verification-only ship | M7 |
| Confidential Plan inspection, literal grammar, publisher/ownership/replay/JSON outcomes | M8 |
| Learn lessons/imports/OCR/citations/SQL/exercises/boards/snapshots/vault | M9 |
| Logo/artwork/editor, transcript/thinking/copy, shortcuts/launcher/commands/footer/status/cost/notices | M10 |
| Search/fetch, LSP trust, subagents/ceilings, context search/export, lazy MCP, codemode/tool_search | M11 |
| Memory, skills/doctor, Gmail, October, Herdr branding/usage/Notes/Calendar | M12 |
| Every durable profile/history/approval/context/learning/ownership category, opt-in import and reversible export | M13 |
| Launcher/install/upgrade/rollback/manifests/health/archives/SBOM/freshness | M14 |
| Actual Mastra/security/WSL/browser/auth/recovery tests, CI/release evidence | M15 |

## Existing issue crosswalk

| Canonical old issue | Disposition | Migration links |
|---|---|---|
| [#21](https://github.com/Rajveerx11/neura/issues/21) | Retain open | M1, M13, M14; M15 verifies its continued accounting |
| [#24](https://github.com/Rajveerx11/neura/issues/24) | Retain open | M2, M6; M15 verifies its continued accounting |
| [#26](https://github.com/Rajveerx11/neura/issues/26) | Retain open | M0, M9; M15 verifies its continued accounting |
| [#28](https://github.com/Rajveerx11/neura/issues/28) | Retain open | M3, M5, M7, M8, M9, M13; M15 verifies its continued accounting |
| [#29](https://github.com/Rajveerx11/neura/issues/29) | Retain open | M1, M2, M4, M6, M8, M9, M11, M12, M13; M15 verifies its continued accounting |
| [#30](https://github.com/Rajveerx11/neura/issues/30) | Retain open | M0; M15 verifies its continued accounting |
| [#31](https://github.com/Rajveerx11/neura/issues/31) | Retain open | M0, M14; M15 verifies its continued accounting |
| [#33](https://github.com/Rajveerx11/neura/issues/33) | Retain open | M5, M12, M13; M15 verifies its continued accounting |
| [#34](https://github.com/Rajveerx11/neura/issues/34) | Retain open | M1, M4, M12; M15 verifies its continued accounting |
| [#57](https://github.com/Rajveerx11/neura/issues/57) | Retain open | M3, M7, M8, M10; M15 verifies its continued accounting |
| [#58](https://github.com/Rajveerx11/neura/issues/58) | Retain open | M5, M10; M15 verifies its continued accounting |
| [#60](https://github.com/Rajveerx11/neura/issues/60) | Retain open | M10; M15 verifies its continued accounting |
| [#61](https://github.com/Rajveerx11/neura/issues/61) | Retain open | M0, M10; M15 verifies its continued accounting |
| [#62](https://github.com/Rajveerx11/neura/issues/62) | Retain open | M3, M10, M11; M15 verifies its continued accounting |
| [#63](https://github.com/Rajveerx11/neura/issues/63) | Retain open | M7; M15 verifies its continued accounting |
| [#64](https://github.com/Rajveerx11/neura/issues/64) | Retain open | M6, M11; M15 verifies its continued accounting |
| [#91](https://github.com/Rajveerx11/neura/issues/91) | Retain open | M7; M15 verifies its continued accounting |
| [#92](https://github.com/Rajveerx11/neura/issues/92) | Retain open | M2, M5; M15 verifies its continued accounting |
| [#93](https://github.com/Rajveerx11/neura/issues/93) | Retain open | M11; M15 verifies its continued accounting |

## Concrete implementation issues

## M0: migration: freeze Neura feature contracts and complete the upstream parity inventory

Dependencies: none. Start here.

### Problem

The source-based reference covers Neura but explicitly does not enumerate every Pi/package command, data format or provider behavior. A chat loop cannot stand in for feature parity.

### Intended outcome

A versioned, source-linked acceptance matrix with one implementation owner and runnable evidence requirement for every baseline feature, public command, configuration input and durable store.

### Existing source to reuse

All 19 agent/extensions entry points; agent/neura modules; `scripts/test-suites.mjs` and scripts/tests; `docs/STATUS.md`, `SECURITY.md` and the audited migration reference.

### Pi-dependent interfaces to replace

Inventory ExtensionAPI events/registries; provider login/catalog; session tree/custom entries/compaction/retries; native commands/resources/images; all six configured extension packages plus native Pi facilities, including codemode, tool_search, context sidecar and delegation formats.

### Scope

Freeze SHA 3ebaac07c8320125bcc32478b5aa3865746a997c; audit exact published upstream artifacts without private profiles; capture synthetic old-runtime fixtures and before/after timing inputs. Record implemented, partial, unavailable and future behavior separately. Map all 19 extensions, 15 command names, configuration categories and persistence categories to the owners below.

### Explicit exclusions

Do not invent missing upstream behavior, close existing hardening, or require performance optimizations for parity. No runtime activation or private-state inventory.

### Positive acceptance tests

Each extension/command/config/store has a source permalink, parity owner, synthetic fixture and evidence status. Existing useful Plan reads, Work edits, YOLO controls, Learn workflows and optional integrations have positive cases.

### Negative acceptance tests

A deliberately omitted feature, unowned blocker, mock-only integration claim or API-key substitution for subscription auth fails matrix review. Unavailable full proof and preview Human Away cannot be marked supported production behavior.

### Data, security, compatibility and rollback

Keep current Pi compatibility checks while Pi remains supported. Source quirks and defects are explicit, not desirable guarantees. Baseline artifacts are additive and rollback requires no data conversion.

### Measurable definition of done

Matrix has no uncovered baseline surface or security/production blocker; upstream package inventory is complete or a named blocking gap; an independent review signs off coverage without certifying unrun tests.

### Evidence and carried obligations

Canonical existing issues: [#31](https://github.com/Rajveerx11/neura/issues/31), [#26](https://github.com/Rajveerx11/neura/issues/26), [#61](https://github.com/Rajveerx11/neura/issues/61), [#30](https://github.com/Rajveerx11/neura/issues/30). Keep their original acceptance criteria; no superseding closure is authorized by this plan.

Useful historical PR work: [#98](https://github.com/Rajveerx11/neura/pull/98), [#88](https://github.com/Rajveerx11/neura/pull/88). Historical CI/review does not attest a new candidate.

Local migration reference sections: `Baseline, scope, and authority`. `Product and feature boundary`. `Complete extension inventory`. `Capabilities currently supplied by Pi and external packages`. `Public command, configuration, and persistence index`. `Known discrepancies and unresolved production work`.

[Public baseline source](https://github.com/Rajveerx11/neura/tree/3ebaac07c8320125bcc32478b5aa3865746a997c). Every source filename above is relative to that repository.

## M1: migration: select exact Pi-free Mastra, provider and terminal package closures

Dependencies: M0.

### Problem

Mastra selection alone does not establish stable imports, Windows operation or an open-source Pi-free dependency graph. Mastra Code TUI currently depends on pi-tui; Code SDK includes a broader graph and native/storage/telemetry dependencies.

### Intended outcome

A reviewed exact package bill of materials and minimum supported import surface, with licenses, source-to-published correspondence, lifecycle review, integrities and rollback.

### Existing source to reuse

`package.json/package-lock.json`; `agent/neura/package.json` and lock; `runtime-contract.json`; `release-manifest.json`; `docs/DEPENDENCIES.md` and `LEARN_DEPENDENCIES.md`; existing bounded registry-query patterns.

### Pi-dependent interfaces to replace

Pi core/AI/TUI and managed pi-* packages. Evaluate published @mastra/core 1.79.0 and @mastra/code-sdk 1.15.0 discovered on 2026-10-23; these are candidates, not approved pins. Reject the unchanged Mastra Code TUI. Select only stable exported auth/dispatch interfaces that pass source and transitive review.

### Scope

Review exact tarballs, source commit/tag and all shipped executable/lifecycle/native/WASM surfaces. Resolve direct exact pins plus immutable transitive locks for core, auth, schema and terminal candidates. Audit Apache-2.0 versus ee licensing, outbound telemetry defaults, Windows prerequisites and install-with-scripts-disabled operation. Prefer existing/file-based persistence; no database/service without an actual feature requirement. Keep any proof-only graph isolated until cutover. This issue also owns the existing runtime compatibility defect: scheduled CI run 39953146644 finds stable Pi 1.4.0 against reviewed 1.3.0. Review/adapt/update exact coupled Pi contracts while Pi remains supported, or explicitly keep support blocked. Do not bypass the gate or downgrade the owner.

### Explicit exclusions

No floating ranges, moving-main copied code presented as a release API, enterprise-only runtime or dependency installation before planning gates. Do not replace working Learn parsers merely because Mastra has workspaces/memory.

### Positive acceptance tests

Install the reviewed lock in a disposable Windows source worktree with scripts disabled; load actual required exports; produce SBOM/license attribution and exact identities. Verify stable auth exports before accepting SDK reuse.

### Negative acceptance tests

Fail on direct/transitive pi-tui, pi-ai, pi-coding-agent, Pi extension packages or equivalent renamed Pi runtime code; unsupported native binaries, missing license/source correspondence, unreviewed install hooks and enabled unapproved telemetry block acceptance.

### Data, security, compatibility and rollback

Update selected graph, runtime contract, managed hashes, documentation and applicable CI together. Preserve the Pi graph/checks until full cutover; do not downgrade an installed Pi. Rollback restores complete previous graphs/contracts and never rewrites private credentials.

### Measurable definition of done

Exact reviewed manifest/lock/SBOM and license record exist; all necessary stable imports load on Windows; every rejected candidate has a reason; no Pi dependency exists in the target closure.

### Evidence and carried obligations

Canonical existing issues: [#21](https://github.com/Rajveerx11/neura/issues/21), [#29](https://github.com/Rajveerx11/neura/issues/29), [#34](https://github.com/Rajveerx11/neura/issues/34). Keep their original acceptance criteria; no superseding closure is authorized by this plan.

Useful historical PR work: [#55](https://github.com/Rajveerx11/neura/pull/55), [#88](https://github.com/Rajveerx11/neura/pull/88). Historical CI/review does not attest a new candidate.

Local migration reference sections: `Runtime and dependency boundaries`. `Verified framework facts and boundaries`. `Open decisions that an implementation agent must resolve explicitly`. `Installation, distribution, dependencies, and launch contract`.

[Public baseline source](https://github.com/Rajveerx11/neura/tree/3ebaac07c8320125bcc32478b5aa3865746a997c). Every source filename above is relative to that repository.

## M2: migration: prove final Mastra dispatch authorization and preserve all five mode boundaries

Dependencies: M0, M1.

### Problem

Provider tool filtering and Mastra permission labels do not prove authorization at actual dispatch, especially for restored or nested calls.

### Intended outcome

First a small headless real-Mastra proof: an allowed action changes only its synthetic target, a denied action has no side effect, and a resumed action cannot reuse stale authority. Extend that same boundary to all five modes.

### Existing source to reuse

`agent/neura/action-policy.ts`, `action-contracts.ts`, `action-paths.ts`, `capabilities.ts`, `mode-state.ts`, `mode-tools.ts`, `plan-policy.ts` and `learn-policy.ts`; `extensions/modes.ts` and `guardrail.ts`.

### Pi-dependent interfaces to replace

Pi tool_call, before_provider_request, setActiveTools, native tool factories and selected-tool restoration. Use the reviewed Mastra final-dispatch path; a wrapper must not leave alternate workspace/programmatic entry paths unmediated.

### Scope

Work default; fresh YOLO consent on restoration; exact selected-tool membership and provider payload filtering; Plan/Learn allowlists; Human Away sole tool/preview; aliases/malformed descriptors; nested/deferred/restored/dynamically activated calls. Session/mode identity must be trusted runtime context, not model-supplied input. Fence pending restoration and recheck concrete targets immediately before effects.

### Explicit exclusions

No new task-autonomy policy engine; #92 remains canonical. No host fallback, automatic Git shipping or broadening Gmail/MCP availability. Headless slice is not a public chat product or full migration.

### Positive acceptance tests

Actual Mastra agent tool dispatch invokes allowed synthetic contained reads/writes; all five mode selections preserve current behavior and selected-tool intent; YOLO positive controls remain explicit. Demonstrate entry through the real framework, not just direct execute calls.

### Negative acceptance tests

Side-effect counters/files remain unchanged for denied tools, malformed input, forbidden nested calls, stale session/mode tokens, changed canonical target, resumed pending approval and unknown mode. Provider hiding alone cannot satisfy these tests.

### Data, security, compatibility and rollback

Keep process-global registries within one authority domain or explicitly session-scope them; never serve concurrent sessions with shared grants/modes. Persisted mode labels are not authority. Rollback disables the experimental entry point without touching old sessions.

### Measurable definition of done

The three initial proofs pass through pinned real Mastra, followed by positive/negative coverage for every dispatch route. Review accounts for every executable path and records remaining framework gaps.

### Evidence and carried obligations

Canonical existing issues: [#92](https://github.com/Rajveerx11/neura/issues/92), [#24](https://github.com/Rajveerx11/neura/issues/24), [#29](https://github.com/Rajveerx11/neura/issues/29). Keep their original acceptance criteria; no superseding closure is authorized by this plan.

Useful historical PR work: [#42](https://github.com/Rajveerx11/neura/pull/42), [#98](https://github.com/Rajveerx11/neura/pull/98). Historical CI/review does not attest a new candidate.

Local migration reference sections: `Non-negotiable contracts`. `Authority and mode lifecycle`. `Enforcement at actual execution`. `Concrete adaptation map`. `Implementation order and acceptance gates`.

[Public baseline source](https://github.com/Rajveerx11/neura/tree/3ebaac07c8320125bcc32478b5aa3865746a997c). Every source filename above is relative to that repository.

## M3: migration: port agent turns, session lifecycle, streaming and provider-neutral history

Dependencies: M2, M13.

### Problem

Pi owns turn settlement, branch history and custom records. A Mastra thread or chat response does not automatically preserve these semantics.

### Intended outcome

A headless runtime adapter with explicit session identity, input provenance, ordered events, usable history and provider switching, shared by later terminal and machine interfaces.

### Existing source to reuse

Neura extension lifecycle handlers; mode entries; Plan event schemas; check-gate generations; `cockpit-state.ts`; persona `NEURA.md` and ship-report prompt composition; current real-session test scenarios.

### Pi-dependent interfaces to replace

ExtensionAPI.on, ctx/sessionManager, appendEntry, sendUserMessage/follow-ups, message envelopes, agent_end versus agent_settled, branch/tree/fork/reload, compaction, queued continuation, image/reasoning/tool-result serialization and abort propagation.

### Scope

Interactive/extension/headless input sources remain distinct. Preserve print/JSON/RPC outcomes, partial streaming, ordinary errors, effort controls and usage. A replaced session invalidates old callbacks before new state is exposed; draining must not deadlock lifecycle cancellation. M3 coordinates shutdown across adapters, M10 disposes terminal/signal resources, and M6 owns child-process cleanup and its evidence. Provider switching must use actual selected models and handle pending tools/signed reasoning safely.

### Explicit exclusions

No multiuser server, hosted memory or generic event bus. Durable external-effect recovery remains #28; authentication implementation is M4. Do not claim universal lifetime safety from the current partial Plan/Learn checks.

### Positive acceptance tests

Real Mastra streams text/tool events, handles queued turns and reaches idle settlement only after retries/continuations; restart/fork/resume retains safe history and Neura events; switch GPT/Claude/local-Qwen fixtures with text/images/tool history and compaction.

### Negative acceptance tests

Aborted/error turns do not start quick proof or Plan retries; stale completion cannot update new UI/events/receipts. Signed/opaque history is not forged; incomplete tool pairs and unavailable models fail safely rather than silently billing another provider.

### Data, security, compatibility and rollback

Version the event/history format under M13. Exclude credentials and private reasoning from public diagnostics. Retain original legacy bytes and a backward-readable export; rollback uses the prior profile without destructive conversion.

### Measurable definition of done

Lifecycle parity matrix passes through real Mastra for normal, aborted, queued, replacement and restored sessions; every event has documented ownership and serialization semantics.

### Evidence and carried obligations

Canonical existing issues: [#28](https://github.com/Rajveerx11/neura/issues/28), [#57](https://github.com/Rajveerx11/neura/issues/57), [#62](https://github.com/Rajveerx11/neura/issues/62). Keep their original acceptance criteria; no superseding closure is authorized by this plan.

Useful historical PR work: [#88](https://github.com/Rajveerx11/neura/pull/88), [#94](https://github.com/Rajveerx11/neura/pull/94). Historical CI/review does not attest a new candidate.

Local migration reference sections: `Runtime lifecycle that must survive the adapter change`. `Context sanitization and provider protocol preservation`. `Persona and report behavior`. `Public command, configuration, and persistence index`.

[Public baseline source](https://github.com/Rajveerx11/neura/tree/3ebaac07c8320125bcc32478b5aa3865746a997c). Every source filename above is relative to that repository.

## M4: migration: preserve ChatGPT subscription login, refresh and multi-provider switching

Dependencies: M1, M2, M13.

### Problem

Neura's openai-codex preset relies on Pi OAuth. OpenAI API-key access and Herdr quota display do not establish ChatGPT subscription model access.

### Intended outcome

A reviewed machine-local authentication adapter supporting ChatGPT subscription login/refresh/restart, Anthropic and the existing local-Qwen endpoint without a Pi dependency.

### Existing source to reuse

`agent/extensions/presets.ts`; `agent/settings.json` preset semantics; scopedProcessEnvironment and redaction; Herdr provider metadata mapping only for display.

### Pi-dependent interfaces to replace

Pi registerProvider/model registry/login/token refresh/model entitlements/stream transport and credential persistence. Prefer stable reviewed Mastra auth/provider exports if M1 validates them; do not copy moving main or depend on pi-ai for OAuth.

### Scope

Browser/device login where supported on Windows; refresh serialization and atomic credential updates; logout/revocation; absent/expired/invalid grants; entitled-model selection; safe preset fallback lookup and reasoning settings; local http://127.0.0.1:8080/v1 text model contract. Document actual authentication support and provider terms/limitations.

### Explicit exclusions

No API-billing substitution, credential scraping, account impersonation or inspection of the owner's existing auth files. Synthetic test identities only; real-account smoke requires an explicitly authorized disposable login. Usage quota reading is not authentication.

### Positive acceptance tests

Through real pinned transport, a consenting test account completes login, streaming, refresh, process restart and another request; concurrent refreshes retain the newest valid token. Anthropic and local-Qwen controls work; provider switches preserve supported history.

### Negative acceptance tests

No key fallback when subscription auth fails. Invalid state/PKCE/callback, revoked refresh, missing entitlement and concurrent stale refresh fail without leaking tokens to logs/model/tools/children. Model switching during a pending tool cannot transfer authority.

### Data, security, compatibility and rollback

Use a separate Neura credential location with restrictive ownership and no credentials in session state/manifests. Legacy credentials remain untouched; document re-login/import consent and rollback. #34 owns broader provider credential process isolation.

### Measurable definition of done

Login/refresh/stream/restart evidence is linked for actual subscription transport, or the issue stays blocked with support explicitly unverified. Required providers and safe error paths pass; exact export/version/license evidence is recorded.

### Evidence and carried obligations

Canonical existing issues: [#34](https://github.com/Rajveerx11/neura/issues/34), [#29](https://github.com/Rajveerx11/neura/issues/29). Keep their original acceptance criteria; no superseding closure is authorized by this plan.

Useful historical PR work: [#98](https://github.com/Rajveerx11/neura/pull/98). Historical CI/review does not attest a new candidate.

Local migration reference sections: `Exact current presets`. `Subscription access is a parity gate`. `Subscription usage metadata`. `Open decisions: Subscription adapter and Provider-neutral history`.

[Public baseline source](https://github.com/Rajveerx11/neura/tree/3ebaac07c8320125bcc32478b5aa3865746a997c). Every source filename above is relative to that repository.

## M5: migration: port exact approval retries and the isolated no-tool Headmaster

Dependencies: M2, M3.

### Problem

Mastra suspension/category grants are weaker than Neura's exact one-use retry binding. Resumed actions must not inherit old authority.

### Intended outcome

One approval mechanism reusing the existing ledger/grant semantics, with fresh execution checks and a Pi-free isolated reviewer runner.

### Existing source to reuse

`approval-store.ts`; `action-policy.ts` binding v2; `headmaster.ts` dossier/parser/clamp; `headmaster-policy.md`; approvals UI/commands and circuit-breaker behavior from `modes.ts/guardrail.ts`.

### Pi-dependent interfaces to replace

Pi print/no-tools/no-session subprocess invocation, custom entries, approval dialog/follow-up scheduling and resumed tool invocation. The reviewer must not be the privileged workspace agent. Auth-free deterministic/reviewer-process fixtures may proceed before M4. M4 remains required for authenticated reviewer integration, not synthetic implementation work.

### Scope

120-second one-use process-local grants bind exact input/canonical target/state/workspace/HEAD/index/worktree; a mismatched attempt consumes the grant. Durable resolution precedes grant creation; restart never resurrects permission. Preserve cross-process locks, bounded short-write/fsync, corrupt-tail/crash-lock rejection and deny-first decisions. Recheck Work's awaited confirmation at final execution, explicitly covering its baseline race.

### Explicit exclusions

Do not invent a second ledger or claim authenticated tamper evidence/recovery already exists. #33 retains keyed integrity, full workspace-bound IDs, remote destination binding, retention and lock recovery; #58 retains improved exception UX.

### Positive acceptance tests

Identical current action executes once after explicit approval; normal audit append/concurrency and bounded reviewer parsing work; deterministic permitted bounded-delete review is preserved. Isolated reviewer has zero tools/resources and sanitized scoped inputs.

### Negative acceptance tests

Changed args, bytes, inode, HEAD/index/worktree, workspace, mode, session, expiry or replay cannot execute. Corruption, lock crash, failed persistence, unavailable/invalid reviewer and headless requests never widen authority. Model approval cannot override deny/human routes.

### Data, security, compatibility and rollback

Old audit rows are historical evidence, not restored grants. Use synthetic ledgers only. Journal schema changes require M13 compatibility and rollback; preserve invalid records for operator inspection rather than repairing silently.

### Measurable definition of done

Actual Mastra resumed dispatch rejects every stale binding and allows the exact positive once; no-tools reviewer isolation is exercised; existing #33 limitations remain separately open and documented.

### Evidence and carried obligations

Canonical existing issues: [#33](https://github.com/Rajveerx11/neura/issues/33), [#28](https://github.com/Rajveerx11/neura/issues/28), [#58](https://github.com/Rajveerx11/neura/issues/58), [#92](https://github.com/Rajveerx11/neura/issues/92). Keep their original acceptance criteria; no superseding closure is authorized by this plan.

Useful historical PR work: [#43](https://github.com/Rajveerx11/neura/pull/43), [#98](https://github.com/Rajveerx11/neura/pull/98). Historical CI/review does not attest a new candidate.

Local migration reference sections: `Approval storage and exact retry`. `Headmaster isolation`. `Enforcement at actual execution`. `Explicit unresolved gaps`.

[Public baseline source](https://github.com/Rajveerx11/neura/tree/3ebaac07c8320125bcc32478b5aa3865746a997c). Every source filename above is relative to that repository.

## M6: migration: preserve Windows containment, WSL2 execution and cancellation boundaries

Dependencies: M2.

### Problem

Changing tool adapters can bypass canonical path checks, scoped environments or the no-host-fallback WSL contract. Current Node cancellation is not a process-tree guarantee.

### Intended outcome

Mastra execution tools reuse Neura's Windows-aware policy/process/sandbox code and accurately report exit, timeout, abort and unavailable isolation.

### Existing source to reuse

`action-policy.ts/action-paths.ts`; `human-away-sandbox.ts`; `process.ts`; `process-security.ts`; `runtime-contract.json`; sandbox/process/policy/fuzz regressions.

### Pi-dependent interfaces to replace

Tool schema/execute adapter, AbortSignal plumbing, sequential execution, tool-result mapping and lifecycle leases. Preserve trusted runtime context rather than accepting workspace/env from the model.

### Scope

Canonical junction-aware containment; UNC/device/ADS/drive-relative refusal; exact Work/Human Away schemas; absolute System32 wsl.exe, validated distro, linked-workspace preflight and bubblewrap unshared network/minimal mounts/env. Keep proof-specific offline runtime hashes/mounts. Classify physical descendant cleanup separately and prove any stronger claim on Windows/WSL.

### Explicit exclusions

No new sandbox backend, silent POSIX full-support claim, worker pooling or host fallback. Transactional candidates/resource promotion remain #24, and reuse evaluation remains #64.

### Positive acceptance tests

Real Windows/WSL replay runs a bounded contained command, captures nonzero exits honestly, verifies no broad drive/home mount or network and accepts correct pinned proof inventory. Canonical ordinary workspace operations remain useful.

### Negative acceptance tests

Missing WSL/bwrap, wrong hashes, links/junctions/ADS/UNC/device paths and changed targets stop before execution. Cancellation/timeout/output overflow cannot become successful evidence even if a cooperative process exits zero; test descendants rather than infer termination from callbacks.

### Data, security, compatibility and rollback

Generic sandbox tools do not inherit proof's complete executable pin guarantee. Preserve existing documented race/hardlink limitations. Rollback keeps exact runtime contracts and never changes system WSL or live environment automatically.

### Measurable definition of done

Contract tests and actual supported Windows/WSL positive/negative replay pass through Mastra; cancellation scope and residual process/race limits are documented without overstating isolation.

### Evidence and carried obligations

Canonical existing issues: [#24](https://github.com/Rajveerx11/neura/issues/24), [#64](https://github.com/Rajveerx11/neura/issues/64), [#29](https://github.com/Rajveerx11/neura/issues/29). Keep their original acceptance criteria; no superseding closure is authorized by this plan.

Useful historical PR work: [#42](https://github.com/Rajveerx11/neura/pull/42), [#55](https://github.com/Rajveerx11/neura/pull/55), [#98](https://github.com/Rajveerx11/neura/pull/98). Historical CI/review does not attest a new candidate.

Local migration reference sections: `Windows process and WSL isolation`. `Deterministic action inspection`. `Verification receipts and /ship`. `Known discrepancies: Process cancellation`.

[Public baseline source](https://github.com/Rajveerx11/neura/tree/3ebaac07c8320125bcc32478b5aa3865746a997c). Every source filename above is relative to that repository.

## M7: migration: port checkpoints, undo and content-bound proof receipts without false PASS

Dependencies: M3, M6, M13.

### Problem

Raw checkpoints are temporary and proof receipts have limited meaning. A framework workflow/checkpoint must not be mistaken for durable external-effect recovery or full engineering verification.

### Intended outcome

Equivalent YOLO raw-byte undo and Work/YOLO verification hooks with correct event lifetime, rollback preservation and honest detector-only/unavailable states.

### Existing source to reuse

`agent/extensions/checkpoint.ts` and `agent/extensions/check-gate.ts`; `agent/neura/verification.ts`; `agent/neura/process-security.ts`; raw-copy/rollback helpers; `scripts/tests/proof.mjs` and `scripts/tests/process-contract.mjs`.

### Pi-dependent interfaces to replace

Pi agent_start/agent_settled/session_shutdown hooks, session receipt append, /undo and /ship registration, feedback scheduling and UI.

### Scope

Pre-turn capture under leases; binary/mode/filename preservation; 20-snapshot/50,000-file/64-MiB bounds; new files preserved by undo; prepared rollback and recovery directory retention. Proof before/after content fingerprints, exact offline runner, changed-candidate rejection, nonaborted idle-only automatic quick checks, separate feedback budgets and generation fencing.

### Explicit exclusions

No automatic Git objects/commits/shipping, no claim temp copies survive restart, no second proof engine. #28 owns durable task/crash recovery and #91 owns complete candidate-bound full evidence; migration must not close either from adapter parity.

### Positive acceptance tests

Actual Mastra turns produce raw snapshots and current-session detector receipts; /undo restores synthetic binary bytes/modes without filters and can undo undo; /ship attempts isolated full proof but preserves unavailable legacy PASS.

### Negative acceptance tests

Aborted or stale sessions cannot publish receipts; untrusted workspace suite JSON cannot upgrade proof; changed bytes/index/candidate reject reuse. Fault-injected restore either rolls back or retains named recovery data and reports uncertainty; no success after unknown restoration.

### Data, security, compatibility and rollback

Keep private snapshot bytes outside source and published diagnostics. Event import is versioned via M13. Crash before/during/after mutation remains #28's explicit state machine, not replayed automatically. Rollback preserves additive receipt history and recovery directories.

### Measurable definition of done

Ported proof/undo positives and fault injections pass through the real runtime; full trusted PASS remains blocked until #91 independently passes; recovery limitations and retained data are explicit.

### Evidence and carried obligations

Canonical existing issues: [#28](https://github.com/Rajveerx11/neura/issues/28), [#91](https://github.com/Rajveerx11/neura/issues/91), [#63](https://github.com/Rajveerx11/neura/issues/63), [#57](https://github.com/Rajveerx11/neura/issues/57). Keep their original acceptance criteria; no superseding closure is authorized by this plan.

Useful historical PR work: [#43](https://github.com/Rajveerx11/neura/pull/43), [#55](https://github.com/Rajveerx11/neura/pull/55), [#94](https://github.com/Rajveerx11/neura/pull/94). Historical CI/review does not attest a new candidate.

Local migration reference sections: `Checkpoints and undo`. `Verification receipts and /ship`. `Release packaging and rollback`. `Explicit unresolved gaps`.

[Public baseline source](https://github.com/Rajveerx11/neura/tree/3ebaac07c8320125bcc32478b5aa3865746a997c). Every source filename above is relative to that repository.

## M8: migration: preserve confidential Plan inspection and owned HTML publication outcomes

Dependencies: M2, M3, M13.

### Problem

Mastra native submit_plan/file writing is not Neura's structured publisher. Plan inspection, request replay, ownership and machine outcomes must survive without broad writes.

### Intended outcome

The current closed Plan research/publish workflow, including bounded confidential inspection, one corrective retry and durable machine-readable terminal outcomes.

### Existing source to reuse

`plan-files.ts`, `plan-policy.ts`, `plan-renderer.ts`, `redaction.ts` and publication helpers; `extensions/plan-artifact.ts` and protected guardrail wrappers; Plan confidentiality/traversal/native-config/browser tests.

### Pi-dependent interfaces to replace

Pi tool factories/truncation, withFileMutationQueue, StringEnum schema helper, session branch append/replay, follow-up scheduling and settlement callbacks. Do not expose Mastra native planning writes or automatic mode transition.

### Scope

Closed shell-free grammar distinct from plan-shell-parser; tracked/global Git exclusions; per-file canonical/descriptor reauthorization; bounded redacted UTF-8 search; signed-history rebasing. Preserve schema, CSP, collision-safe creation, owned path/hash revisions, waiting/planning/published replay, exactly one completed-turn retry and final failed contract in TUI/print/JSON/RPC. Fix the separately identified late-publication lifetime gap with explicit pre-commit/post-await ownership checks.

### Explicit exclusions

No ordinary edits/writes, historical Git content, direct web_fetch or approval-to-implementation transition. Publication event persistence remains honestly distinct from disk success; do not claim an atomic transaction without recovery evidence.

### Positive acceptance tests

Useful source reads/searches and allowed internal links work; structured plan publishes/revises its owned artifact; wait/resume/start-new and headless retry/failure schemas match. Real rendered HTML is usable at mobile/desktop widths.

### Negative acceptance tests

Ignored/private/history/ADS/outside/hardlinked/binary inputs, unknown shell syntax and stale signed payloads never reach provider context. Changed human artifact, slug/project, symlinked plans dir, overflow, abort and session replacement cannot overwrite or claim new-session ownership.

### Data, security, compatibility and rollback

Keep event schemas and original HTML/hash ownership through M13; old disk/event write gaps require reconciliation, not assumed permission. Rollback preserves all human-edited plans and avoids adopting orphan artifacts automatically.

### Measurable definition of done

Ported confidentiality, traversal, publication/replay and real-browser suites pass through Mastra; added session-change races fail safely; no Plan action can write application source.

### Evidence and carried obligations

Canonical existing issues: [#29](https://github.com/Rajveerx11/neura/issues/29), [#28](https://github.com/Rajveerx11/neura/issues/28), [#57](https://github.com/Rajveerx11/neura/issues/57). Keep their original acceptance criteria; no superseding closure is authorized by this plan.

Useful historical PR work: [#88](https://github.com/Rajveerx11/neura/pull/88), [#94](https://github.com/Rajveerx11/neura/pull/94). Historical CI/review does not attest a new candidate.

Local migration reference sections: `Plan inspection, literal command parsing, and confidentiality`. `Plan artifacts: implementation and migration contract`. `Learn and Plan migration ownership and acceptance`.

[Public baseline source](https://github.com/Rajveerx11/neura/tree/3ebaac07c8320125bcc32478b5aa3865746a997c). Every source filename above is relative to that repository.

## M9: migration: preserve Learn lessons, offline imports, citations, exercises and continuity

Dependencies: M2, M3, M13.

### Problem

Learn is Neura-owned pedagogy, rendering and bounded storage, not generic framework memory. Tool termination/provenance and existing stricter public bounds can be lost in a port.

### Intended outcome

All four Learn tools and /learn commands retain practical lessons, accessible boards, PDF/PPTX/OCR, exact citations, bounded grading, explicit snapshots and opt-in vault capture.

### Existing source to reuse

learn-policy/schema/renderers/materials/worker/exercises/files/store/vault modules; extension Learn state and commands; six exact Learn runtime pins/lock; material/workshop/storage/vault/end-to-end/browser fixtures.

### Pi-dependent interfaces to replace

Pi schema registration, text/image result blocks, terminate:true, actual interactive-input provenance, status/custom feedback, session/tree generations and prompt context. Replace fixed .pi vault config consumers via M13/M12.

### Scope

Retain stricter provider-facing bounds despite standalone-validator differences. Lesson/exercise stop at learner-facing boundaries; material/progress can continue. Preserve one-use whole-message answer/preference provenance, revision-bound board commands, historical unverified source restore, English offline OCR, citation identity/excerpts, disposable SQLite authorizer/limits, owned nonoverwriting stores, contiguous vault events/minimized preferences. Close specifically audited post-vault/profile-await lifetime gaps with mode/session checks and explicit artifact-commit semantics.

### Explicit exclusions

No browser-to-agent sync service, automatic workspace snapshot, mastery from reading, broad vault writer, external document fetch or native-parser OS-isolation claim. SQL timeout is not immediate cancellation unless newly proven.

### Positive acceptance tests

Actual runtime imports text/scanned PDFs and ordered PPTX/notes/images offline; exact citations validate; choice/short/subjective/SQL grading works; save/resume produces historical boards; configured vault captures minimized events without raw answers; real browser keyboard/diagram/clipboard workflows pass.

### Negative acceptance tests

Reject malicious ZIP/XML/images, URL/UNC/ADS/hidden/link/hardlink inputs, wrong citation hashes/excerpts, model-invented or replayed answers, stale board revisions, unsafe SQL, unowned stores, corrupt/gapped vault events and altered projections. Session/mode changes during every await cannot publish stale state.

### Data, security, compatibility and rollback

Keep version-1 snapshots/events or version explicit migration; preserve external/user-edited notes. First store creation remains native-Windows-only until separately implemented/tested. Keep long-title vault mismatch visible if not fixed. Rollback retains old boards/snapshots and unchanged event projections.

### Measurable definition of done

All Learn feature categories have real-runtime plus parser/storage/browser evidence, with offline OCR and positive/negative SQL/citation/provenance tests. Unavailable prerequisites and remaining limitations are explicit.

### Evidence and carried obligations

Canonical existing issues: [#28](https://github.com/Rajveerx11/neura/issues/28), [#29](https://github.com/Rajveerx11/neura/issues/29), [#26](https://github.com/Rajveerx11/neura/issues/26). Keep their original acceptance criteria; no superseding closure is authorized by this plan.

Useful historical PR work: [#44](https://github.com/Rajveerx11/neura/pull/44). Historical CI/review does not attest a new candidate.

Local migration reference sections: `Learn: guided tutoring, sources, exercises, and continuity`. `Learn and Plan migration ownership and acceptance`. `Public command/configuration/persistence index`.

[Public baseline source](https://github.com/Rajveerx11/neura/tree/3ebaac07c8320125bcc32478b5aa3865746a997c). Every source filename above is relative to that repository.

## M10: migration: replace pi-tui with the Neura terminal editor, commands and status surfaces

Dependencies: M1, M3, M5, M6.

### Problem

Both Neura and the ready-made Mastra Code terminal use Pi TUI. Full removal requires a different terminal while preserving actual interaction, not just branding.

### Intended outcome

A Windows-usable Pi-independent terminal shell for the same runtime/commands with the logo-only launch and complete editor, transcript, approval and status behavior.

### Existing source to reuse

`ui-tokens.ts`; `cockpit-state.ts`; `command-launcher.ts` matching/dispatch semantics; `neura.ts` launch geometry; `cockpit.ts` layout/cost cache; `transcript-actions.ts` extraction; themes/artwork and public commands.

### Pi-dependent interfaces to replace

CustomEditor, Input/SelectList/components, visibleWidth/truncateToWidth, widgets/footer, keybindings, transcript/reasoning expansion and clipboard APIs. M1 chooses reviewed terminal/input dependencies; use no pi-tui transitively.

### Scope

Preserve Ctrl+Enter submit and Enter/Shift+Enter/Ctrl+J newline; Shift+Tab modes; thinking/launcher/code-copy shortcuts; Esc cancellation; latest-answer/code copy; error visibility; history-aware launch suppression; notices and one-line footer/two-line ambient cockpit. All 15 Neura commands and inventoried upstream/prompt/skill workflows route through normal policy checks. Show actual provider/context/cost, unknown after compaction and danger/preview labels. M10 owns terminal restoration, signal-handler disposal, timers and subscriptions. M3 coordinates shutdown and M6 owns process cleanup. Synthetic terminal work does not wait for M4 account-login evidence; authenticated final parity does.

### Explicit exclusions

No decorative dashboard, altered logo, hidden errors, quota-as-cost claim or unsupported native command omission. #57/#58 own richer autonomy/exception UX; #60 owns measured render optimization.

### Positive acceptance tests

Windows multiline paste, IME/composition, keyboard focus, resize, Unicode/ANSI cell widths, copy fallback and normal streaming work. Test 24/40/56/72/92/120-column surfaces, launcher stress widths, ten-line widgets and reduced-motion behavior with terminal captures. Cancellation, normal exit, startup failure and repeated disposal restore terminal state, dispose handlers/timers/subscriptions and fence late callbacks. Surviving descendants are reported honestly.

### Negative acceptance tests

A stale/removed launcher choice cannot execute a replacement; unsent drafts are not overwritten; revoked mode/session actions cannot dispatch; reasoning/tool payloads are not copied as answer text; safety notices cannot be delayed by render coalescing.

### Data, security, compatibility and rollback

UI carries no authority and grants no capability. Preserve source-owned artwork bytes/aspect ratio and local-only profile behavior. Rollback keeps prior Terminal configuration and keybindings under installer ownership.

### Measurable definition of done

No Pi UI import/lock entry remains in target closure; terminal interaction/width/IME/accessibility evidence and command parity pass, with original logo-only launch preserved.

### Evidence and carried obligations

Canonical existing issues: [#57](https://github.com/Rajveerx11/neura/issues/57), [#58](https://github.com/Rajveerx11/neura/issues/58), [#60](https://github.com/Rajveerx11/neura/issues/60), [#61](https://github.com/Rajveerx11/neura/issues/61), [#62](https://github.com/Rajveerx11/neura/issues/62). Keep their original acceptance criteria; no superseding closure is authorized by this plan.

Useful historical PR work: [#41](https://github.com/Rajveerx11/neura/pull/41), [#94](https://github.com/Rajveerx11/neura/pull/94). Historical CI/review does not attest a new candidate.

Local migration reference sections: `Terminal UI and interaction specification`. `Startup, brand and editor`. `Command launcher`. `Transcript copy`. `Footer, usage and cost`.

[Public baseline source](https://github.com/Rajveerx11/neura/tree/3ebaac07c8320125bcc32478b5aa3865746a997c). Every source filename above is relative to that repository.

## M11: migration: replace developer package adapters for search, LSP, delegation, context and MCP

Dependencies: M2, M3, M6, M13.

### Problem

Removing Pi's installed packages removes developer capabilities beyond Neura's extension files. Mastra tool discovery must not create an alternate unrestricted execution path.

### Intended outcome

Reviewed Pi-free adapters for bounded Ollama search/fetch, project-trusted LSP, isolated subagents, context-sidecar retrieval and explicit lazy MCP, including YOLO codemode/tool-search behavior.

### Existing source to reuse

`mcp.ts` lifecycle/config semantics; `mode-tools.ts` and `capabilities.ts`; process-security/process/redaction; health bounded probes; public exact-package behavior inventory from M0; synthetic native/deferred/runtime tests.

### Pi-dependent interfaces to replace

@ollama/pi-web-search, pi-redact, pi-lsp, pi-subagents, pi-mcp and pi-context; native codemode/tool_search/deferred dispatch. Port only evidenced behavior via stable reviewed exports or direct minimal adapters.

### Scope

MCP global/project precedence and disablement, selected-tool identity, no eager restricted connection or alternate native route; bounded Ollama API; LSP project trust and trusted executable startup; child policy/tool ceilings and isolated single-writer/cancellation state; context chunk search/get/export semantics and legacy retention. Dynamic/nested calls share M2's final guard; external output redacts before model context.

### Explicit exclusions

No generic plugin marketplace, unsupported external skills, automatic LSP/MCP installs, eager credential probes or workflow rewrite. #29 owns further ingress hardening; #93 owns future autonomous review/repair, not delegation parity.

### Positive acceptance tests

Real protocol fixtures exercise Ollama, LSP stdio, MCP HTTP/stdio, child process delegation and context search/export, with actual adapter entry points. YOLO selected tools work and disabled server tools stay removed across mode restoration.

### Negative acceptance tests

Restricted modes neither connect nor expose MCP/indirect tools; denied nested/dynamic/restored calls cause zero side effects. Untrusted project binaries, malformed/oversized responses, cancellation, failed adapter load and missing dependencies cannot trigger fallback, credentials or wider child authority.

### Data, security, compatibility and rollback

Context SQLite and delegation public formats require M13 preservation before conversion. No new mandatory database/server merely to replace a sidecar. Rollback retains original bytes and leaves unknown state untouched.

### Measurable definition of done

Every inventoried acquired capability has a tested replacement or an explicit release-blocking gap; no old Pi package remains in target graph, and real nested/connection/child policy tests pass.

### Evidence and carried obligations

Canonical existing issues: [#29](https://github.com/Rajveerx11/neura/issues/29), [#62](https://github.com/Rajveerx11/neura/issues/62), [#93](https://github.com/Rajveerx11/neura/issues/93), [#64](https://github.com/Rajveerx11/neura/issues/64). Keep their original acceptance criteria; no superseding closure is authorized by this plan.

Useful historical PR work: [#88](https://github.com/Rajveerx11/neura/pull/88), [#98](https://github.com/Rajveerx11/neura/pull/98). Historical CI/review does not attest a new candidate.

Local migration reference sections: `Capabilities currently supplied by Pi and external packages`. `MCP and Gmail`. `Host health diagnostics`. `Concrete adaptation map`. `Public persistence index`.

[Public baseline source](https://github.com/Rajveerx11/neura/tree/3ebaac07c8320125bcc32478b5aa3865746a997c). Every source filename above is relative to that repository.

## M12: migration: port memory, immutable skills, Gmail, October and Herdr without widening access

Dependencies: M3, M5, M11, M13.

### Problem

Optional integrations have separate trust/lifecycle contracts and fixed .pi paths. A general Mastra integration catalog cannot safely replace their existing gates.

### Intended outcome

Compatible optional integrations, disabled/unavailable honestly when unconfigured, with default-off immutable skills and preserved user data/configuration.

### Existing source to reuse

`neura-memory.ts`, `skill-doctor.ts`, `skills-registry.mjs`/manifest; `gmail-guardrail.ts`/capabilities; `october-bus.ts`; `herdr-usage-provider.ts`; all integrations/herdr-* plugins and tests; central redaction/probe helpers.

### Pi-dependent interfaces to replace

Pi resource discovery/actual command-winner identity, hooks/commands/provider metadata and Pi-specific executable/profile assumptions. Rework Herdr agent recognition explicitly so stock Pi is never relabelled or required by Neura.

### Scope

YOLO-only memory/October/MCP behavior; immutable version/hash opt-in guidance and read-only doctor in all modes; Gmail exact read allowlist and headless mutation denial without creating restricted-mode mailbox access. Preserve October peer/tasks semantics; Herdr branding, event-driven usage/cache TTL, notes Leaf/nano and explicit hashed Calendar actions. Separate quota reader from model auth; relocate notes' fixed vault config under M13. Synthetic protocol/integration tests may proceed before M4. Authenticated integration and final parity still require M4 and separate account consent.

### Explicit exclusions

No live bus/mail/calendar/vault mutations, automatic plugin activation, private credential inspection or implied closure of #29/#34. Existing memory/October timeout/auth/redaction gaps remain separate hardening; permissions in skill metadata never grant authority.

### Positive acceptance tests

Synthetic local fixtures prove memory compatibility, actual skill winner identity, supported Gmail read/mutation classification, October task/message routing and Herdr metadata/cache/notes/calendar workflows. Optional failure leaves required core readiness truthful.

### Negative acceptance tests

Skills with wrong digest/collision/links/unlisted files fail; disabled mode/integration never starts a process/network request. Unknown Gmail actions cannot silently pass. No tokens/account objects/raw usage responses enter metadata; stale session/TTL/error results are cleared, and notes/Calendar path/hash tampering refuses access.

### Data, security, compatibility and rollback

Legacy memory/vault selection and external service task state survive without automatic import into trusted prompts. Broader credential isolation and complete Gmail body/attachment intent remain #34. Rollback clears only source-owned plugin metadata/cache, preserving user layouts/notes.

### Measurable definition of done

Each optional integration has protocol/process tests and truthful support states; no credential or private data is needed for test fixtures, no fixed .pi runtime dependency remains, and carried security issues stay open until separately proven.

### Evidence and carried obligations

Canonical existing issues: [#29](https://github.com/Rajveerx11/neura/issues/29), [#34](https://github.com/Rajveerx11/neura/issues/34), [#33](https://github.com/Rajveerx11/neura/issues/33). Keep their original acceptance criteria; no superseding closure is authorized by this plan.

Useful historical PR work: [#45](https://github.com/Rajveerx11/neura/pull/45), [#98](https://github.com/Rajveerx11/neura/pull/98). Historical CI/review does not attest a new candidate.

Local migration reference sections: `Memory and October bus`. `MCP and Gmail`. `Supported skills and discovery`. `Optional Herdr plugins and workspace panes`. `Subscription usage metadata`.

[Public baseline source](https://github.com/Rajveerx11/neura/tree/3ebaac07c8320125bcc32478b5aa3865746a997c). Every source filename above is relative to that repository.

## M13: migration: define reversible legacy profile, history and owned-data preservation

Dependencies: M0, M1.

### Problem

There is no unified Neura export/import. Copying a Mastra thread would omit approvals, Plan ownership, Learn state, memory, context and install ownership.

### Intended outcome

An explicit versioned, opt-in migration/export format and reversible cutover policy using public schemas and synthetic fixtures, without reading the owner's private stores.

### Existing source to reuse

Pi public session/custom-event formats inventoried by M0; Learn version-1 snapshots and vault envelopes; Plan hash ownership; approval reader validation; runtime-install receipt/journal ownership; profile config merge rules.

### Pi-dependent interfaces to replace

Fixed .pi profile consumers, Pi session tree/custom-entry serialization, context/delegation storage access and runtime path discovery. Choose minimum application-controlled persistence only after required semantics are known.

### Scope

Account for settings/keybindings/MCP/model choices, conversations/branches/mode/Plan/proof entries, memory, approvals/locks, context SQLite/delegation state, owned Learn/Plan/vault files, skill selection/extension allowlist, install receipts/staging/backups and temporary checkpoints. Define retained/read-only/imported/unsupported per category, explicit consent, dry-run inventory, identity/integrity and rollback. Credentials require re-login or separately consented provider flow, not bulk copying.

### Explicit exclusions

No live profile scan, session/credential upload, destructive in-place conversion, approval resurrection, unknown-file adoption or promise that temporary checkpoints survive old process shutdown. Never silently discard unsupported state.

### Positive acceptance tests

Synthetic representative old profiles export/import safe histories and all durable owned formats; old bytes/hashes remain identical; config precedence and explicit vault opt-in survive; rollback opens the unchanged old profile and new-only data has a documented export path.

### Negative acceptance tests

Reject corrupt/truncated/oversized/unknown-version/linked/cross-workspace data, forged Plan ownership, invalid vault events and unresolved writer locks. Old approved decisions create zero live grants; old full PASS claims cannot become authoritative; interrupted/repeated migration cannot duplicate effects or overwrite user files.

### Data, security, compatibility and rollback

Keep private data outside source/telemetry and separate imported historical text from instructions. A crash after an external mutation remains unknown until #28 reconciles it; conversion never retries effects. Do not remove legacy files on successful migration.

### Measurable definition of done

Every persistence category has an explicit treatment and tested reversible synthetic migration; unsupported formats retain intact bytes and block any false complete-parity claim. No actual private state was accessed.

### Evidence and carried obligations

Canonical existing issues: [#21](https://github.com/Rajveerx11/neura/issues/21), [#28](https://github.com/Rajveerx11/neura/issues/28), [#33](https://github.com/Rajveerx11/neura/issues/33), [#29](https://github.com/Rajveerx11/neura/issues/29). Keep their original acceptance criteria; no superseding closure is authorized by this plan.

Useful historical PR work: [#43](https://github.com/Rajveerx11/neura/pull/43), [#82](https://github.com/Rajveerx11/neura/pull/82). Historical CI/review does not attest a new candidate.

Local migration reference sections: `Public command, configuration, and persistence index`. `Persistent formats and ownership`. `Open decisions: State backend and legacy data`. `Release packaging and rollback`.

[Public baseline source](https://github.com/Rajveerx11/neura/tree/3ebaac07c8320125bcc32478b5aa3865746a997c). Every source filename above is relative to that repository.

## M14: migration: replace the launcher and managed installer with reversible Pi-free distribution

Dependencies: M1, M3, M4, M10, M11, M12, M13.

### Problem

Current activation, manifests, settings packages and Windows Terminal resources launch Pi from a generated .pi profile. A path rename alone is neither complete removal nor safe installation.

### Intended outcome

An open-source source/artifact distribution and launcher for reviewed Mastra packages with exact runtime identity, managed ownership, honest upgrade/rollback and no global Pi mutation.

### Existing source to reuse

install.ps1; `runtime-install.mjs` stage/seal/activate/recover/check engine; release/runtime/skills manifests; launcher ownership; Terminal artwork/profile/shortcut; deterministic archives/checksums/SBOM and synthetic installer tests.

### Pi-dependent interfaces to replace

Pi prerequisite/version checks, pi update instructions, --no-mcp/--tui-mode flags, package settings merge, .pi target assumptions, PI_SKIP_VERSION_CHECK and Pi-specific compatibility CI/Dependabot group. Replacement freshness policy is exact and reviewed, never floating.

### Scope

Coordinated source pins/lock/contracts/managed hashes/launcher/CI/docs; separate Neura profile and dependencies; preserve settings/model/provider/unrelated files. Cover root and nested Learn install receipts, unknown code refusal, immutable skills, startup full-integrity check and bounded health quick scope. Preserve Windows-first behavior and source-only installation boundary until owner authorizes rehearsal.

### Explicit exclusions

No installation into the live harness, global Pi downgrade/removal, npm publication, push/tag/release/deploy or unsupported clean-host claim. #21 remains canonical for complete cross-component atomicity/bootstrap and release rehearsal, rather than duplicating its implementation requirements.

### Positive acceptance tests

Disposable clean-Windows artifact install, repeat install, upgrade and rollback retain user files and correct exact identities. Launcher starts the target without any Pi executable/library and fails closed on required drift. Missing optional integrations remain optional.

### Negative acceptance tests

Tampered hashes, unknown extensions/modules, interrupted managed/post-activation config, links/path swaps, immutable-skill changes and malformed prerequisites cannot leave a falsely ready installation or erase recovery data. Existing stock Pi still operates unchanged.

### Data, security, compatibility and rollback

Activation of settings/Terminal must have explicit recovery ownership; #21 closure requires actual rehearsal. Rollback stops writers, restores a complete known-good graph/profile/resources and preserves both old and new private data; no history rewrite or audit repair.

### Measurable definition of done

Target archive/SBOM/manifest and disposable-host evidence agree; full dependency/import/launch scan has zero Pi runtime/TUI code; upgrade/rollback preserves synthetic data. Existing #21 obligations remain required for any production claim.

### Evidence and carried obligations

Canonical existing issues: [#21](https://github.com/Rajveerx11/neura/issues/21), [#31](https://github.com/Rajveerx11/neura/issues/31). Keep their original acceptance criteria; no superseding closure is authorized by this plan.

Useful historical PR work: [#82](https://github.com/Rajveerx11/neura/pull/82), [#88](https://github.com/Rajveerx11/neura/pull/88), [#55](https://github.com/Rajveerx11/neura/pull/55). Historical CI/review does not attest a new candidate.

Local migration reference sections: `Installation, distribution, dependencies, and launch contract`. `Installer lifecycle and ownership`. `Release packaging and rollback`. `Health and operational readiness contracts`.

[Public baseline source](https://github.com/Rajveerx11/neura/tree/3ebaac07c8320125bcc32478b5aa3865746a997c). Every source filename above is relative to that repository.

## M15: migration: enforce real-Mastra parity, adversarial tests and honest release gates

Dependencies: M0, M1, M2, M3, M4, M5, M6, M7, M8, M9, M10, M11, M12, M13, M14.

### Problem

A green mock suite or polished terminal cannot demonstrate dispatch/authentication/recovery parity, Pi removal, Windows support or preserved data.

### Intended outcome

A release-blocking evidence matrix and CI path for real Mastra integration, synthetic adversarial data, actual browsers and disposable Windows installation, with experimental/preview labels unchanged until separate gates pass.

### Existing source to reuse

18-suite registry, synthetic isolation/Git fixtures, policy/approvals/fuzz/proof tests, Plan/Learn browser accessibility suites, Herdr/release tests, secret scanner, immutable action pins and required CI job names.

### Pi-dependent interfaces to replace

pinned-pi/real Pi loader/session harness, Pi payload conversion tests, Pi-only current-runtime/freshness checks and installer fixtures only when their replacement is covered. Retain old checks while old runtime is supported; historical tests can remain as data fixtures without executable Pi dependencies after cutover.

### Scope

Add real Agent/tool dispatch allowed/denied/stale-resume tests, subscription transport/login/refresh/restart evidence, actual crash/restart races, Windows/WSL replay, parser/OCR/storage/browser checks, install/upgrade/interruption/rollback and no-Pi closure verification. Keep source-only, live, release and production claims separate; required CI names harness/portable-proof and aggregate remain satisfiable.

### Explicit exclusions

No dropping failing tests, lowering audit thresholds, mock-only claims or automated production declaration. #91 still gates complete full proof; #24 keeps Human Away preview; #26/#29/#33/#34/#28/#30/#21 retain independent acceptance.

### Positive acceptance tests

Required repository checks, strictness rollout owner, feature suites, real Edge screenshots/accessibility, dependency/signature/secret audits and disposable clean-host validation pass for the exact candidate. Link source/version/environment/command outcomes for every claimed feature.

### Negative acceptance tests

CI fails on missing/skipped required checks, stale candidate evidence, leaked synthetic canaries, changed manifests, denied side effects, replayed authority, missing WSL/OCR/browser/provider prerequisites or residual direct/transitive Pi runtime packages. Unknown cost/support stays unknown.

### Data, security, compatibility and rollback

Use only synthetic private-state fixtures; never export raw transcripts. Real-account auth and live rehearsal require separate explicit authorization. Unmet production gates remain named blockers, not waived by migration; rollback restores reviewed exact candidate with data intact.

### Measurable definition of done

No baseline feature or blocker is unowned; all claimed capabilities have candidate-bound evidence, Pi is absent from target runtime/transitive/UI closure, and preserved-data/rollback rehearsals pass. Migration completion does not close production issues without their independent acceptance evidence.

### Evidence and carried obligations

Canonical existing issues: [#21](https://github.com/Rajveerx11/neura/issues/21), [#24](https://github.com/Rajveerx11/neura/issues/24), [#26](https://github.com/Rajveerx11/neura/issues/26), [#28](https://github.com/Rajveerx11/neura/issues/28), [#29](https://github.com/Rajveerx11/neura/issues/29), [#30](https://github.com/Rajveerx11/neura/issues/30), [#31](https://github.com/Rajveerx11/neura/issues/31), [#33](https://github.com/Rajveerx11/neura/issues/33), [#34](https://github.com/Rajveerx11/neura/issues/34), [#57](https://github.com/Rajveerx11/neura/issues/57), [#58](https://github.com/Rajveerx11/neura/issues/58), [#60](https://github.com/Rajveerx11/neura/issues/60), [#61](https://github.com/Rajveerx11/neura/issues/61), [#62](https://github.com/Rajveerx11/neura/issues/62), [#63](https://github.com/Rajveerx11/neura/issues/63), [#64](https://github.com/Rajveerx11/neura/issues/64), [#91](https://github.com/Rajveerx11/neura/issues/91), [#92](https://github.com/Rajveerx11/neura/issues/92), [#93](https://github.com/Rajveerx11/neura/issues/93). Keep their original acceptance criteria; no superseding closure is authorized by this plan.

Useful historical PR work: [#41](https://github.com/Rajveerx11/neura/pull/41), [#42](https://github.com/Rajveerx11/neura/pull/42), [#43](https://github.com/Rajveerx11/neura/pull/43), [#44](https://github.com/Rajveerx11/neura/pull/44), [#45](https://github.com/Rajveerx11/neura/pull/45), [#55](https://github.com/Rajveerx11/neura/pull/55), [#82](https://github.com/Rajveerx11/neura/pull/82), [#88](https://github.com/Rajveerx11/neura/pull/88), [#94](https://github.com/Rajveerx11/neura/pull/94), [#98](https://github.com/Rajveerx11/neura/pull/98). Historical CI/review does not attest a new candidate.

Local migration reference sections: `Validation, CI and release engineering`. `Learn and Plan migration ownership and acceptance`. `Implementation order and acceptance gates`. `Known discrepancies and unresolved production work`.

[Public baseline source](https://github.com/Rajveerx11/neura/tree/3ebaac07c8320125bcc32478b5aa3865746a997c). Every source filename above is relative to that repository.

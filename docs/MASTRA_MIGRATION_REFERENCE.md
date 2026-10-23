# Neura implementation reference for the Mastra migration

> This is a source-based reconstruction and implementation handoff, not evidence that a Mastra implementation exists. The user selected Mastra on 2026-10-23. This document records the behavior to preserve, the existing code to reuse, the Pi-specific surfaces to replace, and the failures that must remain visible.

## Contents

- [How to use this document](#how-to-use-this-document)
- [Baseline, scope, and authority](#baseline-scope-and-authority)
- [Product and feature boundary](#product-and-feature-boundary)
- [Non-negotiable contracts](#non-negotiable-contracts)
- [System topology and ownership](#system-topology-and-ownership)
- [Terminal UI and interaction specification](#terminal-ui-and-interaction-specification)
- [Persona, response contract and providers](#persona-response-contract-and-providers)
- [Capabilities currently supplied by Pi and external packages](#capabilities-currently-supplied-by-pi-and-external-packages)
- [Policy, execution, approvals, recovery, and integration contracts](#policy-execution-approvals-recovery-and-integration-contracts)
- [Plan inspection, literal command parsing, and confidentiality](#plan-inspection-literal-command-parsing-and-confidentiality)
- [Plan artifacts: implementation and migration contract](#plan-artifacts-implementation-and-migration-contract)
- [Learn: guided tutoring, sources, exercises, and continuity](#learn-guided-tutoring-sources-exercises-and-continuity)
- [Learn and Plan migration ownership and acceptance](#learn-and-plan-migration-ownership-and-acceptance)
- [Installation, distribution, dependencies, and launch contract](#installation-distribution-dependencies-and-launch-contract)
- [Health and operational readiness contracts](#health-and-operational-readiness-contracts)
- [Optional Herdr plugins and workspace panes](#optional-herdr-plugins-and-workspace-panes)
- [Validation, CI and release engineering](#validation-ci-and-release-engineering)
- [Migration work allocation for these surfaces](#migration-work-allocation-for-these-surfaces)
- [Public command, configuration, and persistence index](#public-command-configuration-and-persistence-index)
- [Mastra mapping and implementation decisions](#mastra-mapping-and-implementation-decisions)
- [Known discrepancies and unresolved production work](#known-discrepancies-and-unresolved-production-work)
- [Handoff instructions for an implementation agent](#handoff-instructions-for-an-implementation-agent)
- [Verification performed for this reference](#verification-performed-for-this-reference)

## How to use this document

Read the baseline, non-negotiable contracts, runtime lifecycle, and known gaps before implementing a feature. Then use the detailed feature sections and acceptance cases. An agent receiving only this file should understand the product and its boundaries; an agent with the repository must also inspect the referenced implementation before modifying it. This document is not a substitute for source code, binary assets, dependency lockfiles, or a release manifest.

There are three kinds of statements:

- **Current behavior:** implemented in the audited checkout, including limitations and awkward edge cases.
- **Migration requirement:** behavior that a replacement must preserve or deliberately resolve before parity can be claimed.
- **Unverified / open decision:** an integration or design choice that has not been implemented or tested. It must not silently become a claim of support.

Do not turn a known defect into a desired security guarantee. Preserve working behavior, keep limitations explicit, and track any hardening separately with regression tests. Do not silently remove features because Mastra does not provide them natively.

All source paths below are relative to the repository root unless used as Markdown links. Source line references are navigation aids for the audited revision, not permanent API contracts. Private credentials, actual memory, approval logs, session histories, and live-profile data were not inspected or included.

## Baseline, scope, and authority

| Item | Audited baseline |
|---|---|
| Repository | Neura, Windows-first TypeScript/Node engineering-agent harness |
| Source commit | `3ebaac07c8320125bcc32478b5aa3865746a997c` |
| Candidate version | `2.6.0-rc.1` |
| Latest published version according to source | `2.5.1`; candidate publication is not claimed |
| Existing runtime | Exact Pi `1.3.0`, not Mastra |
| Node requirement | `24.15+`; CI declares `24.16.0` |
| Supported complete workflow | Windows; Linux CI covers selected portable contracts |
| Release channel | Experimental, personal/single-user engineering use |
| Production status | Not production-ready; Human Away is preview-only |
| Selected replacement | Mastra; full Pi removal is the working migration assumption, including `pi-tui` |
| Work authorized in this document's creation | Source research and documentation, not runtime migration, installation, publication, or remote mutation |

The checkout is source of truth. `~/.pi/agent/` is a generated live installation and may differ. Do not use live code to overwrite source or infer a live match from the candidate version. Current requirements are in source, `README.md`, `docs/STATUS.md`, and `SECURITY.md`; `plans/` contains historical designs. Where prose and executable behavior differ, this reference calls out the difference.

The standing latest-stable-Pi compatibility policy remains in force for the existing Pi implementation until explicitly replaced as part of the migration. Selecting Mastra does not authorize weakening current version/hash checks or downgrading an installed Pi. New runtime dependencies require exact pins, source/lifecycle review, documentation, and tests. Never install, commit, tag, push, publish, or change a remote system without the required user authorization.

Sources: [current status](STATUS.md), [production gates](PRODUCTION_READINESS.md), [repository instructions](../AGENTS.md), [security policy](../SECURITY.md), [dependency policy](DEPENDENCIES.md).

## Product and feature boundary

Neura is a terminal-first personal engineering agent. The operator starts in a supervised Work mode, can research without implementation in Plan, teach/learn in Learn, deliberately enter unrestricted YOLO, or use restricted Human Away Preview. It combines an existing model/tool runtime with deterministic policy, local artifacts, proof feedback, recovery, and optional integrations.

Preserve these capabilities as a complete product:

1. Branded startup, real task editor, keyboard navigation, conversation rendering, responsive footer, operation/status UI, approvals, notifications, and copy actions.
2. Five explicit modes, safe default, restoration rules, tool selection, runtime dispatch enforcement, headless behavior, and in-flight operation fencing.
3. Multiple providers, authenticated model selection, reasoning controls, local Qwen, and ChatGPT subscription access rather than an API-billing substitution.
4. Plan inspection with confidential-file exclusion and controlled, versioned HTML publication across interactive and machine interfaces.
5. Learn lessons, accessible boards, diagrams, document grounding and OCR, exercises, progress, explicit snapshots, and optional Obsidian capture.
6. WSL2/bubblewrap command isolation, reviewed offline proof dependencies, proof receipts, and detector-only versus full-verification distinctions.
7. YOLO-only raw-byte checkpoints, undo, memory, host diagnostics, MCP connections, and October integration.
8. Supported immutable skill guidance, external provider/package capabilities, optional Herdr plugins, and credential-scoped integration behavior.
9. Reproducible dependencies, startup manifest verification, managed installation/recovery, release gates, and synthetic regression suites.

The product is not a generic chatbot with a shell tool. A migration that only reproduces chat, tool calling, and a terminal is incomplete.

## Non-negotiable contracts

- Deterministic policy outranks model advice, including Headmaster. Tool availability, model-selected modes, permission labels, and descriptions never confer authority.
- Current Neura-only extensions activate only with `NEURA`; ordinary Pi remains stock. The replacement must not hijack or corrupt an independently installed Pi.
- Work is the startup default. Persisted YOLO is never silently restored with full authority.
- Plan is read-only except for the controlled `publish_plan` artifact path under `plans/`. Ordinary file writes, edits, direct web fetch, historical Git content, indirect execution, and MCP are not Plan capabilities.
- Restricted tools are filtered both in the provider payload and at execution. Nested, deferred, restored, dynamically activated, and programmatic calls must cross the same boundary.
- Path authorization uses canonical, junction-aware containment, not a string prefix. Existing application-level race limitations remain documented; they are not an OS isolation claim.
- Work execution, Human Away execution, and Work/YOLO proof use the selected WSL2/bubblewrap path. Missing isolation fails closed; no automatic host fallback.
- YOLO intentionally disables Neura application approval/tool blocking. Confirm entry and keep its danger indication visible after startup. This does not expand user intent.
- Human Away remains explicitly `PREVIEW` until its separate production gates pass.
- Approval means one exact permitted action where supported, not a general tool/category permission. Existing approval storage is not authenticated against a same-user attacker.
- `/ship` verifies. It never commits, pushes, merges, publishes, or repairs tests to manufacture a pass.
- Quick proof PASS is detector-only. It must not become engineering COMPLETE or a full verification claim. The pinned legacy full proof path currently cannot produce a trusted full PASS.
- **Required migration invariant, currently only partly implemented:** old operations must not publish results or receipts into a replacement session. Existing proof and several other paths use generation checks, but Plan publication and some Learn awaits do not fully fence late completion. Restricted mode restoration waits for host leases to drain; this does not mean every session handler waits or every operation holds a lease.
- Credentials, memory, approvals, session data, and raw transcripts stay outside source and public diagnostics. Redaction is pattern-based and not exhaustive.
- Optional integration failure must not falsely report the core harness as unavailable. Conversely, a missing required runtime must not display READY.
- All terminal widgets fit their supported width and ten-line limit; ambient cockpit is at most two lines and footer one line. A custom centered editor is not a ten-line widget.

## System topology and ownership

```text
Repository checkout
  install.ps1 + manifests + locked runtimes
    generated ~/.pi/agent files + launcher + Terminal profile
      launcher/neura.cmd
        validates installed bytes and prerequisites
        sets NEURA=1
        runs Pi --no-mcp --tui-mode regular
          provider/model/authentication + agent loop + sessions
          Neura's 19 extensions
            agent/neura policy, state, filesystem, render, process helpers
            owned workspace stores and optional machine-local integrations
```

There is no required Neura web application server or central cloud control plane. Plan and Learn boards are generated local HTML. The Learn board sends progress back through user-copied commands, not an automatic synchronization API. Optional MCP, model providers, Ollama web search, October, and Herdr have separate network/process boundaries.

| Layer | Current owner | Mastra migration obligation |
|---|---|---|
| Model calls, streaming, conversation loop, provider catalog/login | Pi and provider packages | Mastra/provider integration with equivalent authentication and usable history |
| Transcript/tree/custom entries, branch resume, compaction/retries | Pi | Persist equivalent semantic state; explicitly handle legacy data and interrupted runs |
| Terminal rendering/editor/widgets/selectors/keybindings/clipboard | Pi TUI plus Neura extensions | Replace Pi UI dependencies while retaining exact Neura behavior |
| Mode/action policy and safety | Neura | Reuse; adapt tool events and execution boundary, not model prompts alone |
| Learn/Plan data, rendering and validation | Neura | Reuse bounded schemas and filesystem mechanisms |
| Command execution and proof isolation | Neura + WSL2/bubblewrap + pinned runtime | Keep offline trust and no-fallback behavior |
| Installation, identity, managed-file ownership | Neura | Replace Pi-specific paths/contracts coherently; preserve recovery and user-owned data |
| Optional integrations and acquired package tools | Mixed | Port each explicitly; neither silently drop nor eagerly activate them |

### Complete extension inventory

All 19 current entry points are under `agent/extensions/`.

| Entry point | Responsibilities |
|---|---|
| `neura.ts` | Identity/theme/title, startup editor and fallback, `/dash`, `/notices`, persona, command launcher |
| `modes.ts` | Mode restoration/switching/UI, active and provider tool selection, system contracts, approvals |
| `guardrail.ts` | Runtime deterministic gate, protected Plan tool implementations, result/context redaction |
| `gmail-guardrail.ts` | Gmail read allowlist and interactive confirmation for other exposed Gmail actions |
| `human-away-sandbox.ts` | `work_exec` and `human_away_exec` tool adapters |
| `plan-artifact.ts` | Request lifecycle, request activation tool, publication ownership and machine outcomes |
| `learn.ts` | Four Learn tools, commands, tutor guidance, session-local learning state and vault bridge |
| `checkpoint.ts` | YOLO pre-turn snapshots and `/undo` |
| `check-gate.ts` | Change detection, quick/full proof, receipts, bounded failure feedback |
| `cockpit.ts` | Responsive footer, phase/operation rail, usage/cost and working indicator |
| `transcript-actions.ts` | Latest-answer/code-block extraction and clipboard UI |
| `harness-health.ts` | `/health`, required/optional capability readiness, runtime identity and bounded probes |
| `presets.ts` | GPT/Opus/Qwen presets and local provider registration |
| `neura-memory.ts` | YOLO local facts, memory prompt injection, `/remember`, `/memory` |
| `mcp.ts` | Owned wrapper around filtered Pi MCP package, YOLO discovery/reconnect control |
| `october-bus.ts` | Optional local context bus, local agent/task/learning/decision tools |
| `skill-doctor.ts` | Supported skill discovery gate and read-only identity inspection |
| `ship-report.ts` | End-of-iteration response-format prompt instruction |
| `herdr-usage-provider.ts` | Optional provider/mode/phase metadata bridge to Herdr |

### Runtime lifecycle that must survive the adapter change

| Boundary | Current semantic work | Replacement requirement |
|---|---|---|
| Resource discovery | Supported skill identity and restricted discovery | Validate before exposing instructions or tools |
| `session_start` | Reset session-owned state, restore permitted mode, pause tools during drain, install UI, restore branch-sensitive state | A new session identity invalidates old asynchronous callbacks |
| `input` | Track interactive task, reset applicable retry budgets, identify Plan request lifecycle | Preserve distinctions among interactive input, follow-up, print, JSON and RPC |
| `before_agent_start` | Compose persona, report rules, mode instructions, allowed memory/Learn/October context | Correct ordering, redaction and mode scope; model instructions are not enforcement |
| `agent_start` | Hide launch; initialize active cockpit, YOLO checkpoint and Work/YOLO change fingerprint | Do not run host effects in restricted modes |
| `before_provider_request` | Filter provider-specific tool payload | Provider schema differences must not reintroduce disallowed tools |
| `tool_call` | Authorize exact action, apply Gmail layer, block as required | Every actual dispatch, including nested/replayed calls, is mediated |
| Tool execution start/end | Active operation UI, parent linkage and duration where supplied | Keep model output distinct from execution facts |
| Tool result/context processing | Redact outputs; enforce Plan final-context confidentiality | Preserve pre-delivery checks, not only visual masking |
| `message_end` | Update latest copyable assistant answer and usage cache | Do not accidentally include reasoning/tool payload as answer text |
| `agent_end` | Plan can queue its one publication retry; October can publish a bounded summary | This is not final settlement |
| `agent_settled` | Idle-only cockpit reconciliation; final Plan missing-artifact outcome; non-aborted quick proof | Must mean retries, queued continuation and compaction no longer make run active |
| `session_tree` | Learn invalidates current in-memory board state | Branch changes cannot retain stale revision authority |
| `model_select` | Herdr provider refresh and runtime model state | Keep visible provider/model aligned with actual calls |
| `session_shutdown` | Invalidate generations, cancel/clean owned activity and timers, release subscriptions | No late UI, file ownership or proof receipt attached to a new session |

Important correction: the older architecture overview attributes cockpit completion to `agent_end`. Current `cockpit.ts` uses `agent_settled` and requires `ctx.isIdle() === true`. Intermediate `agent_end` must not mark completion. Relevant executable coverage: `scripts/tests/pi-runtime.mjs`, `scripts/tests/ui.mjs`, and `scripts/tests/state-machine.mjs`.

## Terminal UI and interaction specification

Sources: [identity](../agent/extensions/neura.ts), [cockpit](../agent/extensions/cockpit.ts), [shared UI state](../agent/neura/cockpit-state.ts), [tokens](../agent/neura/ui-tokens.ts), [theme](../agent/themes/neura-dark.json), [launcher](../agent/neura/command-launcher.ts), [copy actions](../agent/extensions/transcript-actions.ts), [UI tests](../scripts/tests/ui.mjs), [launcher tests](../scripts/tests/command-launcher.mjs).

### Actual visual system

Use source tokens as the current reference. `DESIGN.md` still describes a copper/tungsten palette; current implementation and tests explicitly use logo blue. Do not restore copper by following that stale prose. Brand artwork is the supplied PNG, not an approximation or generated replacement.

| Token | Hex | Use |
|---|---|---|
| canvas | `#080a0f` | Base background |
| surface | `#101522` | Editor, user/custom message backgrounds |
| raised | `#151c2d` | Selection |
| accent | `#2979ff` | Brand, Work, headings, active focus |
| focus | `#72a7ff` | Code/reasoning accents |
| plan / info | `#7cc7ff` | Plan, links, function/type accents |
| learn | `#af94ff` | Learn mode |
| human / warning | `#f3c860` | Human Away, approvals and warning |
| text | `#f3f6ff` | Main text |
| muted | `#b4bece` | Secondary information |
| dim | `#8894a8` | Quieter metadata |
| border | `#26334c` | Neutral borders; editor borderAccent equals border |
| error | `#ff8178` | Errors, YOLO danger |
| success | `#5cd99c` | Successful outcomes |

Theme-specific values additionally include borderMuted `#1a2335`, pending tool background `#0d1220`, successful tool background `#0c1b17`, failed tool background `#211215`. Markdown and syntax colors derive from these tokens. Tests require text, muted, dim, accent, success, warning, error, links and function colors to reach at least 4.5:1 contrast on canvas.

Geometric glyphs: Neura/YOLO/pending `◆`, Plan/Learn/Human Away `◇`, success `✓`, error `×`, prompt `›`, divider `─`. Render widths must account for ANSI sequences and visible terminal cells, not JavaScript string length. Core helpers are not all interchangeable: `truncateText` slices Unicode code points, while Pi TUI `visibleWidth`/`truncateToWidth` handle cell width.

Width tiers: micro `<48`; narrow `<56`; compact `<72`; standard `<92`; wide `>=92`. Test ordinary surfaces at 40, 56, 72, 92 and 120 columns; health/footer also 24; launcher has 1, 2, 8 and 24-column stress tests. Never display `(widget truncated)` or let labels wrap unexpectedly.

### Startup, brand and editor

- A fresh empty conversation gets a centered real task editor. Existing message history, a resume reason, or a fork reason suppresses the full-height launch so history remains visible.
- Dedicated Windows Terminal profile supplies local artwork. The terminal layer renders only a five-row fixed-width `NEURA` block wordmark, the literal version/READY status, a blank separator, the `NEURA AGENT · TYPE YOUR TASK` label, and the real editor. Do not add a second approximated logo, dashboard, continuity history, or onboarding panel.
- The wordmark rows are `█  █ █▀▀▀ █  █ █▀▀▄ ▄▀▀▄`, `██ █ █▀▀  █  █ █  █ █  █`, `█ ██ ██▀▀ █  █ █▀▀  █▀▀█`, `█  █ █▀▀  █  █ █ ▀▄ █  █`, and `▀  ▀ ▀▀▀▀ ▀▀▀▀ ▀  ▀ ▀  ▀`.
- Content width is `min(84, terminalWidth, max(30, floor(terminalWidth * 0.58)))`. Left padding is `max(0, floor((width-contentWidth)/2))`; top padding is `max(0, floor((terminalRows-contentLineCount-1)/2))`. Each line is clipped to available width. Tests count nine nonempty initial content lines with the empty native editor.
- `LaunchEditor` subclasses Pi `CustomEditor`, keeping normal input functionality. Save/restore the previous editor factory when showing/hiding. On `agent_start`, remove launch and restore editor. `/dash` toggles the same surface; session shutdown removes it.
- Without TUI/editor API, attempt a centered five-row logo-only `neura-launch` widget. UI failures must not block startup.
- Attempt session-only `neura-dark` theme and terminal title `Neura · <cwd>`. The checked-in settings still say `theme: dark`; extension activation applies Neura styling. Ordinary Pi is unaffected.
- Artwork filename remains `launch-artwork.png`. It is local Apache-2.0 project artwork supplied on 2026-09-15, SHA-256 `5389D9F43E09D27D714D4ECFB2E9D638FA24C271384B388780AB3F5075589D76`. Keep original aspect ratio and documented profile behavior; do not fetch art at runtime. [Artwork provenance](../agent/neura/launch-artwork.md).

### Input and shortcuts

| Key / command | Behavior |
|---|---|
| `Ctrl+Enter` | Submit task editor |
| `Enter`, `Shift+Enter`, `Ctrl+J` | Insert editor newline; intentional protection against pasted/snippet newlines becoming steering messages |
| `Shift+Tab` | Cycle Plan, Work, YOLO, Human Away, Learn; confirmation still applies |
| `Ctrl+Shift+T` | Cycle thinking effort; frees Shift+Tab for modes |
| `Ctrl+Shift+K` / `/launcher` | Search commands and modes |
| `Ctrl+X` | Existing Pi whole-answer copy; Neura advertises it but does not implement this shortcut itself |
| `Ctrl+Shift+X` | Choose a fenced code block from latest assistant answer |
| `Esc` | Existing runtime interruption; advertised as `Esc stops safely`, not proof of process-tree termination |
| `Ctrl+O` | Existing runtime thinking expansion, advertised in hidden-thinking label |

Mastra does not inherit these Pi bindings automatically. Reimplement the user behavior, including clipboard and thinking expansion, or record an explicit parity failure.

### Mode transition and approval presentation

Mode changes show a seven-line boundary widget below the editor only when UI exists and runtime mode is TUI. The lines are `NEURA / BOUNDARY CHANGE` with the mode's position, its glyph/name, four capability rows, and the final verdict. Frame is clamped to 0–6; resolved rows are `min(4,max(0,frame-1))`. Unresolved values are muted; resolved values use text color. Before the last frame the verdict reads `APPLYING POLICY · <resolved> / 4`; the last frame uses the mode color and final boundary message. All lines are clipped by terminal cell width.

| Mode | Four capability rows | Final message |
|---|---|---|
| Plan | workspace: read + plan artifact; publisher: plans/*.html only; sensitive: locked; remote: research reads only | BOUNDARY APPLIED · research + visual plan · source writes locked |
| Work | workspace: structured read + patch; execution: WSL2 sandbox; sensitive: confirm / locked; remote: locked | BOUNDARY APPLIED · supervised workspace engineering |
| YOLO | filesystem: full access; network: full access; approvals: disabled; autogit: off | DANGER FULL ACCESS · no sandbox · no approvals |
| Human Away | workspace: WSL2 sandbox only; reviewer: isolated Headmaster; sensitive: defer to operator; network: unshared / locked | BOUNDARY APPLIED · workspace-only mount · return queue armed |
| Learn | materials: PDF + PPTX references; lessons: visuals + short bullets; practice: contained exercises; workspace: source writes locked | BOUNDARY APPLIED · visual learning + bounded practice |

The animation advances every 52 ms across seven frames, then holds 520 ms. `NEURA_REDUCED_MOTION=1` starts on the final frame and holds 400 ms. Generation checks prevent an old transition timer from clearing the new widget; disposal clears both interval and hold timeout. The token file also defines immediate 60 ms and settle 340 ms, but those constants are not extra delays in this transition implementation.

Approval display is capped at ten lines. Pending view shows the newest record: heading/count, rule, paused label/id, task, intent, exact action, reviewer/risk evidence, boundary, fallback, and grant status. An eligible record says `one identical retry · one use · 120 s`; a denied record says grant unavailable. Audit view shows at most four records, each with risk/id/summary then status/reason. Critical risk is error-colored, high risk warning-colored, lower risks muted. Empty states explicitly say there are no waiting actions or no review records. Closing the widget is distinct from resolving an approval. Source: [mode and approval renderer](../agent/extensions/modes.ts#L70).

### Shared cockpit state and precedence

`cockpit-state.ts` keeps process-local state behind `Symbol.for("neura.cockpit-state.v1")`, allowing multiple module copies to share it. It has subscribers; publication catches individual listener errors. This is not durable storage or multi-user isolation. A Mastra multi-session host cannot reuse one global state object for all sessions without introducing cross-session leakage.

State fields:

| Field | Shape / meaning |
|---|---|
| `phase` | `READY`, `BRIEF`, `WORK`, `REVIEW`, `VERIFY`, `RECOVERY`, `COMPLETE`, `DEGRADED` |
| `launchVisible` | Suppresses ambient footer while launch is visible |
| `task`, `step` | Optional concise objective/current step |
| `operation` | `{verb, target?, startedAt?}` |
| `notices` | Up to eight `{id,message,detail?,tone,persistent?}` records, de-duplicated by id |
| `proof` | `{scope: quick\|full, status: running\|passed\|failed\|unavailable, detail?}` |
| `approval` | `{id,agent,task,exactAction,boundary,fallback,risk,approvable}` |
| `copy` | `{available,codeBlocks,feedback?}` |
| `checkpoint` | `capturing`, `ready`, `restoring`, `restored`, `failed` |
| `degraded` | Optional reason |
| `updatedAt` | Timestamp assigned by state patch |

Every patch passes through central structured redaction. Patches are shallow merges; callers replace nested `copy`/proof objects intentionally. Reset begins READY with no notices, hidden launch and unavailable copy.

Cockpit renders below editor, maximum two lines. READY contributes no phase line. Phase WORK is displayed as `RESPONDING`, avoiding confusion with Work mode. First line combines phase, step and task; second-line precedence is: approval, failed proof, running proof, active operation, degradation, detector-only quick PASS, copy feedback, available-copy controls. Copy controls appear only at width >=48. Active tool targets choose `path`, `file_path`, `command`, `query`, then `pattern`; redact, flatten whitespace, truncate to 72 code points.

Interactive input sets BRIEF and clears old step/operation/proof/approval/copy/degradation. Agent start sets WORK/active. Tool start shows tool+target; end shows composing response. On final idle settlement, precedence is REVIEW if approval exists, DEGRADED if degraded, VERIFY if failed proof or quick PASS, otherwise READY for aborted work or COMPLETE. Abort records `step: cancelled`. COMPLETE without a proof claim is conversation completion, not certified engineering completion.

Working indicator uses four frames: dim `▪`, muted `▪`, accent `■`, muted `▪`, every 180 ms. Working text includes the interruption hint. Hidden-thinking text is `Thinking · Ctrl+O expand`. Clear working text at settlement; unsubscribe on shutdown.

### Footer, usage and cost

Footer is one line, omitted entirely while launch is visible. Left side prioritizes mode badge, context, then cost. YOLO badge is `◆ YOLO · DANGER`; Human Away includes PREVIEW. Right side collapses by width: wide directory+branch+model+thinking, standard branch+model+thinking, compact model+thinking, narrower model only. Model text caps are 13 characters below 56 columns, 20 below 92, otherwise 32. Prefer a two-cell separation; drop/truncate right metadata before overflowing left side.

Context shows used tokens, window and rounded percentage. Missing token usage after compaction displays `?`, not zero. Color warning begins at 70%, error at 90%. Cost displays three decimals, or `cost n/a` if unknown. `NEURA_COST_WARNING` is an optional positive finite threshold, not an execution budget. Sum billable assistant and tool-result messages plus usage/branch-summary/compaction entries; support numeric cost or `cost.total`. Cache increments on message end, then reconciles from stored entries on final idle settlement and branch changes. Do not double-count cached and reconstructed totals. Detached MCP/LSP extension-status rows are deliberately excluded from footer chrome.

### Notices

`/notices` displays a widget; `/notices close` hides it. Render header with total count, newest four notices, optional indented detail, closing hint, maximum ten lines. Error/warning/success tones color actual outcomes. Showing notices must not hide upstream/runtime errors. Persistent flag is metadata; no durable-notice store is implemented here. `addCockpitNotice` replaces an existing id and caps in-memory list at eight.

### Command launcher

- Available only in TUI with UI support; duplicate opens are ignored. Uses public registry metadata, not filesystem paths, argument history or private integration state.
- Command names must match `[a-zA-Z0-9_.:-]+`. Descriptions are centrally redacted and control characters replaced with spaces.
- Registry sources include extensions, prompts and skills. Current Pi public registry does not supply all built-ins; do not present the current launcher as a complete native command catalog.
- Mode command expands into five specific mode selections. Search lowercases and splits whitespace, requires every word across command/description/mode/shortcut/source, and ranks matches in command names first.
- Four visible list rows. Native Input owns IME/editing and cursor; native SelectList owns selection. Up/down, page up/down by four, Enter selection, Esc cancel. No animations/timers. Focus returns to editor on completion/cancel.
- All actions disable while a previous session drains, a host operation runs, or a turn is active. Self-launch is disabled. Health/undo/MCP/memory require YOLO; ship requires Work/YOLO; Learn requires Learn. Skill doctor is read-only and not YOLO-gated.
- Refresh registry/mode while open, again on selection, and after selector closes. A removed selection cannot silently dispatch the newly selected replacement. Session generation change invalidates a pending selection.
- Extension commands dispatch through the existing normal command path, preserving their handlers' checks/confirmations. Prompt/skill selections only stage `/<name> ` in an empty editor; never overwrite an unsent draft or silently execute them.
- Show Shift+Tab for mode, Ctrl+Shift+K for launcher, and Ctrl+Shift+X for clip only when code blocks exist. Failure uses a generic safe message and suggests direct slash command.

### Transcript copy

Only assistant text is copyable: string content or joined text blocks, not tool calls, reasoning, credentials from hidden state, or arbitrary session objects. On session start find latest assistant text on current branch; update on assistant message end. Empty assistant messages do not erase prior usable text.

`/clip answer` copies whole trimmed answer. `/clip code` and Ctrl+Shift+X show code-only chooser. `/clip` shows answer plus code blocks; invalid argument shows usage. Code parsing recognizes triple-backtick fences, takes first info token as language or `text`, optionally detects path in later tokens containing slash/backslash/dot, strips one final newline from code, and labels first nonempty line at up to 42 characters. This is deliberately not a complete Markdown parser. No-fence and no-answer states warn without copying.

Selection uses numbered options plus Close. Successful copy updates notification and cockpit feedback for 1,200 ms; a later copy resets timer. Shutdown clears timer. Failure suggests terminal selection/current Pi whole-message copy. The new frontend must update that fallback wording if Pi has been removed.

## Persona, response contract and providers

Sources: [persona](../agent/neura/NEURA.md), [report rules](../agent/extensions/ship-report.ts), [presets](../agent/extensions/presets.ts), [settings](../agent/settings.json), [Herdr bridge](../agent/extensions/herdr-usage-provider.ts).

### Persona and report behavior

The identity extension reads `~/.pi/agent/neura/NEURA.md` once during registration, tolerating absence. It appends that persona to the system prompt before a run. Identity is Neura, a personal engineering agent for Rajveer; tone is terse and factual, no emoji, geometric symbols allowed. Engineering guidance favors reuse, root-cause fixes, caller inspection, trust-boundary validation and verified capabilities. It tells the model to honor modes and never evade denied/deferred actions. Skill guidance must resolve actual installed catalog entries, not invent capabilities. Calendar work uses an explicitly connected account, never infers account identity from Gmail. These are instructions, not technical permission enforcement.

Additional persona instructions require a concrete answer/result after tools, safe useful progress before asking for clarification, verification of changing facts rather than guesses, and brief acknowledgment/correction of mistakes. Delegation guidance calls for a scout in unfamiliar code, an oracle for risky decisions, and a reviewer after nontrivial implementation, applying worthwhile review feedback; trivial changes can skip delegation. Post-worthy shipped work may receive a one-line LinkedIn suggestion, never an unsolicited drafted post. These remain advisory prompt behavior, subject to the user's request and actual available capabilities.

`ship-report.ts` adds an end-of-iteration format: What I did, Why, Do this now only when manual steps exist, and one Key takeaway. It is injected behind NEURA, not a deterministic response validator. Do not mistakenly treat `/ship` as the producer of this prose; the report rule applies to completed work iterations generally.

### Exact current presets

| Preset | Provider | Model id | Behavior |
|---|---|---|---|
| `gpt` | `openai-codex` | `gpt-5.5` | Checked-in default; subscription-backed route |
| `opus` | `anthropic` | `claude-opus-5` | Alternate model; existing UI describes token-billed extra usage |
| `qwen` | `local-qwen` | `qwen3-coder-30b-a3b` | Local llama.cpp server, separately started by operator |

These are current source identifiers, not a claim that every account/provider currently offers them. Resolve exact provider/model first, then newest lexicographic model-id prefix for dated catalog variants. Invalid/missing preset shows available choices. Missing model suggests provider login. Model-change failure is caught and reduced to a credential-oriented safe error; do not surface raw provider exceptions.

Local provider uses `http://127.0.0.1:8080/v1` with OpenAI completions-compatible API, text-only inputs, reasoning false, zero configured token costs, context 32,768, maximum output 8,192. The source contains a nonsecret placeholder key because the registry wants a value; it is not a real credential or proof the local service authenticates. Neura does not start or download the model in this extension.

Subscription access is a parity gate. Working with an OpenAI API key is not evidence that ChatGPT subscription login, token refresh, model entitlements, streaming, and restart work. Keep account credentials machine-local and outside model-visible state. Test provider switches with pending tools, accumulated histories, reasoning settings and errors; do not simply rename providers in settings.

### Herdr provider/mode/phase bridge

Bridge registers only when both NEURA and `HERDR_ENV=1` are present. Reporting additionally needs pane id and an absolute existing `HERDR_BIN_PATH`; no PATH lookup. It maps `openai-codex` to `codex`, `anthropic` to `claude`, `cursor` to `cursor`, and clears provider token for other models. Metadata source is `neura.pi-usage`; plugin id is `neura.usage`. Report uppercase mode and current cockpit phase with `pane report-metadata`; session/model change additionally invokes plugin `refresh`.

Updates debounce for 120 ms, preserving a pending refresh request across subsequent state changes. Each subprocess uses hidden Windows execution and five-second timeout. Errors are optional-integration failures and are swallowed. Session/model/mode/cockpit events trigger updates; shutdown cancels timer and subscriptions. This bridge never obtains provider credentials. Existing bridge subprocesses do not use the general YOLO host-operation lease; document that distinction rather than claiming every Herdr operation is mode-isolated. Plugin details and data minimization appear later in the installation/integration section.

## Capabilities currently supplied by Pi and external packages

Removing Pi removes functionality outside the 19 Neura extension files. This inventory prevents a migration from claiming parity after only porting those files. These packages are exact settings pins, not permission grants.

| Existing dependency / facility | Behavior depended on | Replacement obligation |
|---|---|---|
| Pi coding-agent, AI and TUI `1.3.0` | Agent loop, providers/login, tools, schema utilities, streaming, sessions/custom entries/tree, editor/commands, reasoning, context/usage, cancellation, extension loading | Map each consumed API and user workflow; do not retain Pi transitively while claiming full removal |
| `@ollama/pi-web-search@0.0.5` | `web_search`/fetch backed by local Ollama at `127.0.0.1:11434` | Preserve bounded search and mode-specific fetch denial; web retrieval is external access, not offline behavior |
| `@spences10/pi-redact@0.0.14` | Tool-output redaction before model context | Port output-processing behavior in addition to Neura's central display/policy redaction |
| `@spences10/pi-lsp@0.0.44` | Language-server integration and project-trust checks | Preserve optional LSP feature with reviewed executable startup and mode boundary; current environment may not have a server |
| `pi-subagents@0.41.0` | Pi subprocess delegation and local delegation state | Replace subprocess/backend while retaining isolation, policy and tool restrictions; configured package presence does not mean every mode exposes subagents |
| `@spences10/pi-mcp@0.0.58` | MCP transport/tools; package extension filtered with `extensions: []` | Replace through Neura-owned connection lifecycle, not automatic startup |
| `@spences10/pi-context@0.1.15` | Local SQLite context sidecar under live harness | Define supported migration/retention before replacing or discarding context data |
| Native Pi `codemode`, `tool_search`, deferred calls | Programmatic calling and dynamic tool activation | Current positive behavior exists in YOLO; restricted modes must deny even if tools are activated/restored |
| Native Pi commands/resources | Session resume/tree/fork, compaction, queued continuations, prompt templates, images/content blocks, login/model/effort UI and normal error display | Preserve Neura-dependent workflows and enumerate any intentionally unsupported native conveniences before calling migration complete |

Required root dependencies are not installed in the audited checkout. This audit inspected the exact manifest, source adapters and repository tests, not every implementation detail of every external package. Their complete UI/command catalogs, data migrations and provider quirks remain dependency-level verification work; inventing them here would be less useful than naming the boundary precisely. `docs/DEPENDENCIES.md` contains prior source-review evidence, which is historical evidence rather than a fresh audit.

No private memory/session/SQLite files should be opened to design migration. Use synthetic fixtures and versioned public formats. Preserve legacy files intact until an explicit migration and rollback strategy is tested; do not deserialize old approvals as new authority.


## Policy, execution, approvals, recovery, and integration contracts

This section describes the checked-out implementation, including its limitations. None of the described protections should be attributed to Mastra automatically. The migration must reconnect these Neura-owned contracts to Mastra's actual execution and lifecycle hooks, then demonstrate equivalent behavior with positive and negative tests. This audit inspected source and existing tests; it did not execute commands inside WSL, invoke providers, read private memory or approval records, or validate crash recovery experimentally.

### Authority and mode lifecycle

The five modes, in cycling order, are `plan`, `work`, `yolo`, `human-away`, and `learn`. Work is the initial mode. The process-wide registry uses `Symbol.for("neura.mode-state.v1")`, with the current mode, listeners, active host-operation count, and pending restoration state. This registry deliberately survives separately loaded extension modules within one process; it is not durable across a process restart. The current architecture assumes one operator/session authority domain per process. A Mastra host serving concurrent sessions must scope this registry and the approval-grant registry to the intended session/operator rather than accidentally sharing modes or grants. This is a migration isolation requirement, not a request to add multiuser product features. Sources: `agent/neura/mode-state.ts:1`, `agent/extensions/modes.ts:161`.

| Mode | Effective authority and exposure |
| --- | --- |
| Plan | Its exact allowlist, contained inspection, bounded research, questionnaire/request handling, and the dedicated plan publisher. Generic writes, edits, and execution are unavailable. Plan publication is the sole controlled workspace write exception. |
| Work | `read`, `grep`, `find`, `ls`, `bash`, `edit`, `write`, and `work_exec`, subject to the previously selected tools. Native bash is restricted to recognized read-only inspection; development execution uses the WSL sandbox. Sensitive actions require an interactive decision or are denied. |
| YOLO | Restores the user's selected ordinary tools, including optional integrations. Neura application approvals and tool blocking are bypassed intentionally. Native Windows execution has the signed-in user's authority and no Neura OS sandbox. |
| Human Away Preview | Only `human_away_exec` is provider-visible. Deterministic inspection, the isolated reviewer, and exact retry grants govern execution. The preview designation is part of the current product contract. |
| Learn | Its exact bounded research and four learning tools. No generic shell, edits, writes, MCP, or Plan publication. Dedicated Learn stores and an explicitly configured vault are separate controlled write boundaries. |

Mode filtering does not simply replace the tool list permanently. The extension remembers previously selected non-mode-only tools, observes additions and user removals while a restricted mode hides them, preserves ordering, deduplicates, and restores only tools that still exist. A previously selected MCP tool whose server has subsequently been disabled must not reappear. MCP configuration merges the global `mcp.json` with the first existing project `mcp.json` or `.mcp.json`; `disabled: true` or `enabled: false` disables a server. Mode-only tools are `publish_plan`, `plan_request`, `work_exec`, `human_away_exec`, and the four Learn tools. Sources: `agent/neura/mode-tools.ts:6`, `agent/extensions/modes.ts:161`.

Every restricted turn reapplies the boundary at interactive input, `before_agent_start`, and `before_provider_request`. The final hook filters an already snapshotted provider payload, not only the live tool registry. Supported schema shapes include top-level `tools`, `config.tools`, `toolConfig.tools`, Google `functionDeclarations`, and names carried in `name`, `function.name`, or `toolSpec.name`. Aliases such as `Read`, `Bash`, `Grep`, `Edit`, `Write`, `Find`, `Glob`, and `Ls` are mapped to their canonical names. Malformed descriptors are removed. Exact selected-tool membership and the remote capability ceiling both apply. A migration that merely hides UI tools leaves this boundary incomplete. Source: `agent/neura/mode-tools.ts:11`.

Capability metadata describes effects; it never grants authority. It includes effects (`read`, `write`, `execute`, `delete`, `remote-mutation`, `unknown`), scope (`workspace`, `plans`, `mailbox`, `external`, `session`, `unknown`), reversibility, network, secrets, optional timeout bounds, and approval class (`task-scoped`, `exception-boundary`, `unclassified`). A null timeout means that the caller owns the bound. Unknown metadata does not by itself mean an action is denied, but exact mode allowlists still apply. The remote ceiling includes remote mutation, every mailbox capability, and external capabilities that are not task-scoped. Sandbox tools explicitly have `secrets: "possible"`: mounted repository files and scripts can contain secrets despite a cleared host environment. Source: `agent/neura/capabilities.ts:1`.

`setMode` rejects unknown modes, changes during a pending restore, and mode changes while a host-operation lease is active. `acquireHostOperation()` defaults to YOLO-only, rejects the wrong mode or a pending restore, and returns an idempotent release function. Some operations explicitly allow Work as well. `restoreMode` accepts restricted modes, immediately applies one when no lease exists, or places the visible mode in Work and queues restoration until all old leases finish. A superseded pending restoration resolves false. The `session_start` handler must not await this drain because other lifecycle handlers may need to cancel the operation being drained. Sources: `agent/neura/mode-state.ts:34`, `agent/neura/mode-state.ts:59`, `agent/neura/mode-state.ts:79`.

Mode persistence is a custom session entry, `neura-mode-state`, containing `{ mode, changedAt }`, where the timestamp is ISO text. A session starts in Work, then restores the latest valid entry; an invalid recorded mode resolves conservatively to Plan. A saved YOLO state is first restored as Work and requires fresh interactive confirmation before YOLO can be reentered. Session and transition generations discard stale asynchronous confirmations. Mode changes require the agent to be idle both before and after an awaited confirmation. Noninteractive YOLO entry fails closed. A successful change persists its entry and clears stale cockpit task, step, operation, proof, approval, and degraded fields. Sources: `agent/extensions/modes.ts:25`, `agent/extensions/modes.ts:461`, `agent/extensions/modes.ts:514`.

Commands are `/mode plan|work|yolo|human-away|learn|next|status`; underscores/hyphens are normalized, an empty argument opens the interactive chooser when available, and Shift+Tab cycles modes. Restricted prompts explain the active boundary, but prompt instructions are not the enforcement mechanism. Unknown mode state and pending restoration expose no provider tools. The user-bash hook in this extension blocks pending restoration; other explicit interactive shell affordances must be audited separately rather than assumed to inherit model-tool policy.

Mode prompts also carry product behavior that the migration must preserve. Work directs engineering execution to `work_exec` and requires deliberate YOLO escalation for broader authority. YOLO states explicitly that wider permissions do not expand task scope or authorize unsolicited stage/commit/push/publish/deploy operations. Human Away directs useful work through its sole sandbox tool, forbids rephrasing/splitting/encoding around a stopped verdict, and requires a report rather than fallback if isolation is unavailable. Plan requires evidence-backed research followed by one visual HTML artifact, 1–3 useful relationship visuals, 2–8 steps, realistic verification, and a directional future-state preview only when visible behavior changes; after publication it stops for approval. Learn directs one practical concept at a time, a useful visual when appropriate, 3–5 short bullets, an example, an action, progressive hints, explicit objective-vs-discussion grading, validated source citations, and remediation using prior difficulties. It forbids claiming mastery from reading and distinguishes optional saved workspace snapshots from automatic minimized capture to an explicitly configured vault. Source: `agent/extensions/modes.ts:32`.

### Deterministic action inspection

`inspectAction` constructs an `InspectedAction` containing the tool name, canonical workspace, redacted summary, category, risk, route, reason, safer path, action/workspace fingerprints, approval binding, target facts, and capability metadata. Routes are `allow`, `review`, `human`, and `deny`; risk is `low`, `medium`, `high`, or `critical`. Categories are `read-only`, `workspace-change`, `bounded-delete`, `protected-data`, `protected-control`, `remote-mutation`, `broad-destruction`, `unclassified-shell`, and `external-tool`. Source: `agent/neura/action-contracts.ts:1`, `agent/neura/action-policy.ts:411`.

Path checks normalize supported Unicode spaces, optionally remove a leading tool alias `@`, decode a valid `file://` URL, and expand a supported home spelling. Before target I/O, they reject control characters, UNC/device/extended namespaces, NTFS alternate streams, drive-relative paths, and other unsupported colon spellings. On Windows, root-relative slash paths are rejected too. Existing targets use realpath identity; nonexistent targets resolve through the nearest existing ancestor and append unresolved components. Containment uses canonical path components, not a textual prefix, so a junction cannot turn an apparent workspace child into an authorized external target. Sources: `agent/neura/action-policy.ts:167`, `agent/neura/action-policy.ts:270`.

Secret-path detection includes `.env` variants, `.envrc`, `.npmrc`, `.netrc`, `.pypirc`, `.git-credentials`, SSH private-key names, PEM/key files, auth/credential JSON patterns, cloud credential directories, Kubernetes configuration, and Docker configuration. Protected controls include `.git`, workflow configuration, agent settings/keybindings/MCP configuration, the installer, supported-skill registry/manifests, runtime installation code, and the security-sensitive extension/shared-module files enumerated by the source. The complete regex/list must remain a shared reviewed input; inventing a shorter replacement would change authority. Source: `agent/neura/action-paths.ts:1`.

Ordinary reads of a secret or external target route to `human`; Work additionally protects control-file reads. Ordinary contained reads pass. Writes and edits without a valid contained target, or targeting secrets or controls, route to `human`; routine contained writes pass. Target facts distinguish files, directories, existence, Git tracking, size, and generated-looking paths. Generated means a path under `dist`, `build`, `coverage`, `.cache`, `cache`, `tmp`, or `temp`, or a `.tmp`/`.cache` suffix; this is a heuristic, not proof that an artifact is disposable.

Shell classification is ordered. Empty commands and recognized broad destruction are denied. Examples include formatting, SQL drop/truncate, infrastructure destruction, Kubernetes namespace deletion, Docker system pruning, and broad recursive force deletion. Secret access, protected-control access, remote Git/deploy/publish mutations, and unsupported or ambiguous path forms cannot become routine approved work. A literal deletion can reach `review` only for one generated-looking, untracked, contained file; other deletion shapes require a human or are denied. Recognized read-only inspection passes. Work's sandbox additionally recognizes bounded Git status flags and `node scripts/(verify|check)-*.mjs|js`. Recognized development commands include supported npm/pnpm/yarn/bun test/lint/build/check/typecheck/verify forms, selected compiler/test tools, `node --test`, Python pytest, Go tests, Cargo test/check/build, .NET test/build, and directory creation. Other shell text routes to human review. Sources: `agent/neura/action-policy.ts:24`, `agent/neura/action-policy.ts:358`.

This command-name recognition does not establish that repository-controlled scripts are harmless. A test/build script can mutate its writable workspace, including controls. Human Away is still preview because its current execution model is not a transactional worktree with approved-delta publication or comprehensive CPU/memory/process/storage resource enforcement. The migration must carry this limitation explicitly until the production gate is implemented and tested.

Approval binding version 2 contains `canonicalTarget`, `targetStateFingerprint`, `head`, `indexFingerprint`, `worktreeFingerprint`, and `inputFingerprint`. The exact action hash covers stable key-sorted tool input, tool name, and normalized workspace. Workspace state uses HEAD, stage-index bytes, porcelain status, and hashes of changed targets. Git errors yield sentinel states such as `no-head`, `no-index`, and `not-a-git-workspace`; this is not identical to the stricter verification snapshot. The Git reads are bounded at 2.5 seconds and 16 MiB. A targetless remote mutation can be retry-eligible, so the binding does not establish an external service's unchanged state. Sources: `agent/neura/action-policy.ts:94`, `agent/neura/action-policy.ts:114`, `agent/neura/action-policy.ts:382`, `agent/neura/action-policy.ts:691`.

### Enforcement at actual execution

The guardrail replaces Pi's `read`, `grep`, `find`, `ls`, and `bash` definitions. It preserves Pi settings for native behavior outside Plan. In Plan, these replacements execute the bounded Plan inspection service; parsed bash is an inspection request, never a shell command. Read content disallows image MIME delivery, uses a 10-second budget, and is redacted. A session-local set marks tool calls that passed through safe Plan execution. Old/native tool results absent from that set are withheld from Plan context, and `context_with_system` applies final contextual redaction. Source: `agent/extensions/guardrail.ts:16`.

At `tool_call`, pending restoration blocks everything. `codemode` and `tool_search` require YOLO, including indirect/deferred execution paths. Learn and Plan delegate to their dedicated policies. YOLO intentionally bypasses the remaining Neura action gate. Unknown mode state is denied. Work inspects the action with protected control reads enabled, permits an allowed action except non-read-only native bash, denies deterministic denial unconditionally, and otherwise requests an interactive confirmation. Headless Work refuses the action. The current Work branch does not recompute its action binding after that asynchronous confirmation; do not describe it as having the stronger state-bound retry semantics of Human Away. Source: `agent/extensions/guardrail.ts:101`.

Human Away first attempts to consume a matching exact retry grant, then allows deterministic routine actions, then invokes Headmaster for remaining cases. Reviewer approval is clamped by deterministic policy. Approved bounded deletion is recorded as executed when possible, but the current branch catches and ignores failure to append that executed audit record. Denied/deferred decisions must still remain stopped if recording fails; failure surfaces a degraded cockpit state. This difference means the entire Human Away execution path is not universally audit-write-fail-closed.

The reviewer circuit breaker aborts after three consecutive stopped decisions or ten stopped decisions in a rolling window of fifty. The consecutive counter resets on `agent_start`; the rolling history lives with the extension instance. An approved review resets the consecutive counter, whereas an ordinary deterministic allow does not call the same outcome recorder. Stop messages forbid disguising, splitting, or retrying the denied action. Preserve these actual semantics or deliberately replace them with a documented and tested design.

### Approval storage and exact retry

The default audit directory is `~/.pi/agent/neura/approvals`, overridable by `NEURA_APPROVAL_DIR`; `audit.jsonl` stores decision and resolution events. Records contain a short UUID-derived ID, timestamp, workspace identity, fingerprints, sanitized action summary, category/risk, sanitized reviewer decision, `approvable`, and a materialized status. Statuses are `pending`, `executed`, `approved`, `denied`, and `dismissed`. Full raw tool inputs and secrets are not intentionally stored. Summaries cap at 300 characters; decision text is sanitized and capped at 500. Source: `agent/neura/approval-store.ts:18`.

Each event includes `prevHash` and a SHA-256 hash over stable ordered JSON. The first predecessor is `GENESIS`. Reading verifies every JSON line and the chain before materializing state. This detects ordinary corruption, truncation/reordering where detectable by the current chain reader, and accidental edits; it is not authenticated protection against the same operating-system user. Legacy records without a binding cannot receive a retry grant. Pending records deduplicate on action/workspace/binding identity. Pending lists are newest first, recent lists default to twenty, and an ID prefix can select a pending record.

A cross-process `writer.lock` directory covers read, deduplication, and append. Contention polls every 10 ms with a **10,000 ms** deadline; Windows `EPERM` also counts as contention. Other errors fail immediately. No stale lock is stolen automatically. Appending loops over short writes, fsyncs, closes, and releases the directory lock in `finally`. Corrupt audit tails and crash-left locks fail closed pending operator inspection; automatic repair, retention, and a complete recovery protocol are not implemented. `SECURITY.md` currently says two seconds, which disagrees with `approval-store.ts:143`; the source uses ten seconds. Sources: `agent/neura/approval-store.ts:97`, `agent/neura/approval-store.ts:119`, `agent/neura/approval-store.ts:140`.

Retry grants are process-local entries under `Symbol.for("neura.approval-grants.v1")`, not saved permission. A record must be pending, approvable, and bound. A grant expires after `GRANT_TTL_MS = 120_000`, is keyed by action fingerprint, and also matches workspace and binding hashes. Consumption deletes it before checking all validity conditions, so a mismatched attempt consumes the grant too. The next attempted action is freshly inspected, binding the grant to current input, canonical target/state, HEAD, index, and worktree. Persisted resolution happens before grant creation: a crash can leave `approved` in the audit without an executable grant, and that must remain safe. Sources: `agent/neura/approval-store.ts:236`, `agent/neura/approval-store.ts:250`.

`/approvals` accepts `audit`, `close`, `approve <id>`, `deny <id>`, and `dismiss <id>`. `close` clears the widget first. Pending restore blocks permission actions; Learn refuses approval-record access. With no arguments, interactive UI selects a pending record; the default decision is **Keep denied**. The explicit approve command is already an operator action and does not add another confirmation. Only retry-eligible records can be approved. Successful approval persists resolution, creates the one-use grant, and sends a follow-up directing the agent to retry the identical action and stop if input/state changed. Human Away surfaces its pending queue once on interactive input. Source: `agent/extensions/modes.ts:120`, `agent/extensions/modes.ts:485`.

### Headmaster isolation

Headmaster is a one-shot no-tool review process, not another privileged coding agent. Current code locates the installed Pi Node entry point and invokes print/no-session/no-extensions/no-skills/no-context-files/no-prompt-templates/no-tools, text output, low thinking, and a dedicated system policy. It optionally forwards a validated provider/model selection, supplies only a sanitized structured dossier, uses a scoped process environment with `NEURA_HEADMASTER=1`, hides its window, and runs in the workspace. Default bounds are 60 seconds and 512 KiB. `NEURA_HEADMASTER=off`, process errors, invalid output, and cancellation produce no reviewer authority. Sources: `agent/neura/headmaster.ts:23`, `agent/neura/headmaster.ts:101`, `agent/neura/headmaster-policy.md`.

The JSON parser accepts a fenced or surrounding-text object only when its decision enum, reason, and safer path are valid; text fields cap at 500. The deterministic clamp always denies a `deny` route, always defers a `human` route regardless of a model's approval, and treats missing/invalid results as defer. `approve_once` for `review` is possible only for an exception-boundary `bounded-delete` with contained, existing file, generated, and untracked facts. It cannot turn broad destruction, secret access, remote mutation, or an unknown shell into permission. Source: `agent/neura/headmaster.ts:60`.

The migration can reuse the dossier, parsing, and clamp semantics. Pi executable discovery and invocation must be replaced with a Mastra-compatible isolated no-tool runner. A nested call using the normal workspace agent, its memory, extensions, tools, or environment would weaken the current boundary. Reviewer output remains untrusted advice; deterministic policy owns the decision.

### Windows process and WSL isolation

`work_exec` and `human_away_exec` have exact JSON schemas: required `command` string of 1–16,000 characters, optional integer `timeoutSeconds` of 1–600, and no extra properties. Default timeout is 120 seconds. Both are sequential tools. Work's tool directly verifies ready Work mode; Human Away verifies its mode. Results are text containing `exit`, then nonempty `stdout`/`stderr`. Source: `agent/extensions/human-away-sandbox.ts:1`.

Execution requires native Windows, `wsl.exe`, and WSL `bwrap`; there is no host-execution fallback. `wsl.exe` comes from the absolute Windows System32 path. Its host environment is reduced to SystemRoot/WINDIR, System32 PATH, TEMP, and TMP. `NEURA_WSL_DISTRO`, when provided, must match a bounded 1–64-character distro-name pattern. Workspace conversion uses realpath plus `wslpath -a -u --` and accepts one absolute returned path. Conversion is bounded at ten seconds. The recursive workspace preflight visits up to 200,000 entries, including ignored entries, and refuses symlinks/junctions. It does not claim hard-link isolation or a race-free filesystem transaction. Sources: `agent/neura/human-away-sandbox.ts:23`, `agent/neura/human-away-sandbox.ts:150`.

Bubblewrap uses `--unshare-all`, `--die-with-parent`, `--new-session`, `--cap-drop ALL`, and `--clearenv`. It mounts `/usr`, `/bin`, `/lib`, `/lib64`, and `/etc` read-only; supplies `/proc`, `/dev`, and a tmpfs `/tmp`; creates `/tmp/home`; and binds only the canonical workspace writable at `/workspace`. HOME, PATH, and LANG are explicitly set, and the command runs as `sh -lc` in `/workspace`. Windows drive roots and the WSL user's home are not broadly mounted; the network namespace is unshared. Read-only `/etc` is still visible, so “no filesystem secrets anywhere” would be a stronger unsupported claim. Output is capped at 1 MiB and normally centrally redacted. Sources: `agent/neura/human-away-sandbox.ts:46`, `agent/neura/human-away-sandbox.ts:177`, `agent/neura/human-away-sandbox.ts:228`.

Proof execution has a stricter reviewed runtime than generic Work commands. `NEURA_WSL_UV_DIR` and `NEURA_WSL_PROOF_WHEELHOUSE` must be safe absolute POSIX paths, outside `/mnt`, without traversal. Inventory verification checks exact uv/uvx hashes, exact CPython path/version/package build/architecture/hash and package verification, and exact wheel filenames/count/hashes with no linked runtime artifacts. Inventory has a fifteen-second bound; the optional sandbox execution probe has thirty seconds. Runtime artifacts are read-only mounted at `/tmp/neura-bin` and `/tmp/proof-wheels`, and hashes are checked again inside the sandbox before launching proof. A fresh mode-700 cache lives under `/tmp/uv-cache`. Failed trust checks must never execute the command. Generic sandbox development tools do not all receive these proof-specific pins. Sources: `agent/neura/human-away-sandbox.ts:69`, `agent/neura/human-away-sandbox.ts:94`, `agent/neura/human-away-sandbox.ts:115`, `agent/neura/human-away-sandbox.ts:243`.

The reusable Node process primitive uses `execFile` without a shell. Its result distinguishes `ok`, `completed`, termination (`exited`, `spawn-failed`, `cancelled`, `timed-out`, `output-limit`, `failed`), exit code, error code, signal, cancellation/timeout facts, stdout/stderr, and monotonic duration. A normal nonzero exit is completed but unsuccessful. Deadline expiry stays a failure even if a cooperative SIGTERM handler exits zero. Cancellation takes classification precedence while retaining the fact that a deadline already expired. Output overflow is not relabeled as timeout. Invalid Node argument/options errors reject. Timeout zero disables the deadline. This implementation sends SIGTERM and closes streams; it is explicitly not a process-tree termination guarantee or hard physical-exit deadline. Source: `agent/neura/process.ts:29`.

The shared process environment inherits only APPDATA, COMSPEC, HOME, LANG, LC_ALL, LOCALAPPDATA, PATH, PATHEXT, SystemRoot, TEMP, TMP, USERPROFILE, WINDIR, plus deliberate extras. Automatic executable discovery rejects repository-contained executables both lexically and canonically. Named Git on Windows is additionally checked against the runtime contract's SHA-256 and version; candidate locations include an explicit `NEURA_GIT_EXECUTABLE` and Program Files Git. Arbitrary absolute executables are not all given this Git-specific pin check. POSIX Git locations are explicit but do not use the Windows hash contract. Source: `agent/neura/process-security.ts:7`.

Automatic Git disables paging, optional locks, lazy fetch, fsmonitor, hooks, attributes/excludes files, credential helpers, askpass, signature display, mailmaps, global/system configuration, and terminal prompts. These settings prevent inspection from running repository-supplied helpers/filters or reaching credentials through normal Git mechanisms. The core convenience adapter trims output and defaults to three seconds/4 MiB; verification's adapter preserves raw stdout and completion status. Sources: `agent/neura/process-security.ts:94`, `agent/neura/core.ts:40`, `agent/neura/verification.ts:28`.

### Checkpoints and undo

Checkpoint capture is YOLO-only, occurs before `agent_start`, and holds a host-operation lease. It requires a Git root with HEAD, but **does not create a Git object, commit, stash, or index change**. Git enumerates tracked files plus nonignored untracked files; raw bytes are copied into an OS temporary `neura-ckpt-*` directory. Limits are 50,000 files and 64 MiB. Git enumeration uses hardened arguments/environment, ten seconds, and 16 MiB. Ignored untracked files are excluded; later-created files are intentionally not deleted by undo. Sources: `agent/extensions/checkpoint.ts:15`, `agent/extensions/checkpoint.ts:113`.

Canonical source checks reject links and special files. Descriptor reads use no-follow/nonblocking flags where available and compare identity/stat before and after. The snapshot digest includes names, executable-bit mode, and bytes; the field called `tree` is a digest, not a Git tree object ID. A snapshot also records its root, temporary directory, file list/modes, local time label, last interactive prompt truncated to forty characters, and possible recovery directories. Equal-content snapshots deduplicate; the newest twenty are retained. Capture failure displays a warning but does not stop the agent's work. Source: `agent/extensions/checkpoint.ts:44`, `agent/extensions/checkpoint.ts:234`.

`/undo list` shows available session snapshots. Actual restore requires YOLO and a lease. Restore revalidates paths/root, captures pre-undo state, and first prepares rollback copies under `neura-rollback-*`. Each replacement uses a private same-directory `.neura-restore-*` file, exclusive creation, fsync, mode application, and rename. Failure attempts rollback in reverse order; failed rollback preserves recovery directories and leaves the snapshot available. A successful restore can retain the pre-undo checkpoint so undo itself can be undone. Fresh post-failure comparison prevents a false “unchanged” message when state is uncertain. Source: `agent/extensions/checkpoint.ts:163`, `agent/extensions/checkpoint.ts:264`.

This is not an atomic whole-worktree transaction, Git history/index restoration, or durable restart recovery. Snapshot metadata is process-local, and `session_shutdown` removes temporary snapshot data. Source comments and historical architecture wording describing Git plumbing/objects are stale for the current implementation; migration documentation must use the actual raw-copy behavior. Source: `agent/extensions/checkpoint.ts:313`.

### Verification receipts and `/ship`

Verification fingerprints are independently computed from a real Git root, HEAD, staged-index bytes, and actual raw worktree bytes. They include tracked files and nonignored untracked files, executable mode, and a missing-file sentinel. They reject submodules, conflicted stages, linked/special files, escaping paths, identity changes, over 50,000 files, and over 64 MiB. Git collection has a ten-second/8 MiB bound. Ignored untracked files do not affect this fingerprint, while tracked ignored files do. File bodies stay local to the helper. Source: `agent/neura/verification.ts:37`.

Proof uses `uvx` 0.12.11, `/tmp/neura-bin/python3.12`, `proof-of-work-agent==0.2.0`, and explicit `cryptography==49.0.0`, `cffi==2.1.0`, `pycparser==3.0`, `PyYAML==6.0.3`. Arguments enforce isolated, offline, no-config, no-index resolution from `/tmp/proof-wheels`; the command is `proof-of-work check --json --base HEAD`, plus `--no-tests` for quick checks. Default bounds are ninety seconds quick and six hundred seconds full. A caller must supply the isolated executor; absence is unavailable, not host fallback. Sources: `agent/neura/verification.ts:123`, `agent/neura/verification.ts:149`.

The runner's trimmed stdout must parse as JSON with boolean `passed` and an array of string `reasons`. Incomplete process completion, abort, malformed payload, or a claimed pass with nonzero exit is unavailable. A definitive reported failure can come with a normal nonzero exit. Reasons are centrally redacted, capped at twenty entries and five hundred characters each. Legacy full PASS remains **unavailable even with aggregate successful test flags** because the pinned runner does not supply trusted required-suite, candidate-bound evidence. Quick PASS means detector-only feedback and never COMPLETE engineering verification. A before/after fingerprint change while proof runs also makes the receipt unavailable. Source: `agent/neura/verification.ts:123`.

Receipt schema version 1 contains scope (`quick` or `full`), fingerprint, changed-file list, status, completion timestamp, and optional quick/incremental evidence. `.proofofwork/neura-checks.json` is supplementary workspace-authored data, never authoritative proof. Its bounded reader accepts at most 64 KiB, rejects links/identity changes, uses a one-second limit, validates schema version, a 64-hex fingerprint, bounded date/status fields, and at most thirty-two named suite results. A matching report can be labelled current; it cannot upgrade runner failure/unavailability or a full gate. Sources: `agent/neura/verification.ts:164`, `agent/neura/verification.ts:179`.

The check gate operates in Work and YOLO. `runModeProof` verifies exact runner arguments and delegates only to the sandbox executor. It snapshots at agent start, then automatically runs only on nonaborted `agent_settled` with UI present, changed worktree bytes, and no proof already running. An absent initial snapshot becomes degraded. One AbortController and generation token govern the in-flight run. Session replacement/shutdown cancels work and clears initial snapshot, quick cache, and feedback state; stale results cannot append a receipt or update the new session UI. A current receipt is appended as `neura-verification`. Source: `agent/extensions/check-gate.ts:8`, `agent/extensions/check-gate.ts:26`.

A failed quick result sends one follow-up requesting the root cause be fixed without weakening/deleting tests; interactive user input resets that suppression. Full failure can send another follow-up. `/ship` requests a fresh full check under a lease, refuses a concurrent check, and never commits or publishes. A quick result cannot satisfy `/ship`. The migration must preserve event order, settled-vs-aborted distinction, generation invalidation, and root-bound cached receipt identity. Sources: `agent/extensions/check-gate.ts:109`, `agent/extensions/check-gate.ts:130`.

### Redaction and context trust

The central redactor covers known secret assignments, environment/header/CLI forms, complete private-key blocks, URL passwords and sensitive query values, known provider token prefixes, JWTs, and long high-entropy strings. It limits output after redaction and supports budget checks. Several scanners are deliberately linearized to avoid regex-driven denial of service. It is heuristic; unknown secrets can escape detection. Source: `agent/neura/redaction.ts`.

Plan context handling additionally withholds images and opaque thinking. Signed assistant turns and paired tool results that cannot safely be modified in place are rebased into explicitly historical, untrusted user text, avoiding fabricated signatures or dangling tool results. Tool arguments are redacted. Exact protocol IDs/names are retained only where compatible with the safe unsigned structure. A Mastra message adapter must preserve these semantics rather than directly editing provider-signed content.

The central redactor is used by policy summaries, reviewer dossiers, approval text, sandbox output, verification reasons, and Gmail/health summaries. Memory and October do not consistently use it; the next sections deliberately describe those weaker current behaviors rather than extending the redactor claim to all integrations.

### MCP and Gmail

The current MCP extension loads the installed agent directory's `npm/node_modules/@spences10/pi-mcp/dist/index.js` via file URL when present, otherwise the package specifier. It suppresses `MY_PI_MCP_EAGER_CONNECT` during extension initialization and `session_start`, restoring the prior environment value in `finally`. Its proxy permits the MCP `before_agent_start` connection path only when exact selected MCP tools require it and a ready YOLO host-operation lease can be obtained. `/mcp` discovery also requires a YOLO lease. Source: `agent/extensions/mcp.ts:8`.

The launcher separately disables Pi native MCP with `--no-mcp`; a legacy-package import failure must never reenable the native route. Real-Pi tests exercise configuration overrides, reload, failures, and nested/deferred tool resolution. In Mastra, replace the Pi extension proxy with controlled lazy connection and discovery, retaining configuration precedence, selected-tool identity, restricted-mode exclusion, environment handling, lifecycle fencing, and no hidden alternate MCP path.

Gmail recognizes names beginning exactly `mcp__gmail__`. Capability classification uppercases the suffix before checking the closed read allowlist: `GMAIL_GET_PROFILE`, `GMAIL_GET_MESSAGE`, `GMAIL_GET_THREAD`, `GMAIL_GET_DRAFT`, `GMAIL_GET_LABEL`, `GMAIL_GET_FILTER`, `GMAIL_GET_SEND_AS`, `GMAIL_GET_IMAP_SETTINGS`, `GMAIL_GET_POP_SETTINGS`, `GMAIL_GET_VACATION_SETTINGS`, `GMAIL_GET_AUTO_FORWARDING`, `GMAIL_GET_FORWARDING_ADDRESS`, `GMAIL_LIST_MESSAGES`, `GMAIL_LIST_THREADS`, `GMAIL_LIST_DRAFTS`, `GMAIL_LIST_LABELS`, `GMAIL_LIST_FILTERS`, `GMAIL_LIST_SEND_AS`, `GMAIL_LIST_FORWARDING_ADDRESSES`, `GMAIL_SEARCH_EMAILS`, `GMAIL_SEARCH_MESSAGES`, `GMAIL_FETCH_EMAILS`, and `GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID`. Unknown actions count as potential remote mutations. Source: `agent/neura/capabilities.ts:29`.

The Gmail hook bypasses its prompts in YOLO, blocks Plan/Learn, allows known reads in other modes if actually exposed, and otherwise requires interactive confirmation or denies headless. Mutation descriptions cover sending, replies, forwarding, deletion, filters, send-as, settings, updates, imports, and inserts; unknown mutations use a generic warning. Summaries select useful recipient/subject/ID/filter/settings fields, centrally redact them, and bound values to 180 characters rather than dumping message bodies. Source: `agent/extensions/gmail-guardrail.ts:8`.

Restricted mode selection currently hides all Gmail tools, including reads, because mailbox capability is under the remote ceiling. The Gmail hook is defense in depth and does not create a Work Gmail feature or expand any mode allowlist. Preserve that distinction when mapping a Mastra integration catalogue to tools.

### Memory and October bus

Persistent memory is a single fixed `~/.pi/agent/neura/MEMORY.md`. In YOLO, `before_agent_start` reads its full trimmed content into the system prompt and instructs the agent to update durable facts. `/remember` appends a UTC-dated bullet, adding a heading for a new file; `/memory` displays current contents. Both commands are YOLO-only. There is no file-size bound, schema, locking, provenance envelope, cross-user separation, or automatic redaction in this module. This is current behavior and an ingress/security debt, not an example of trusted structured memory. Mastra memory must not silently treat imported text as authoritative instruction. Source: `agent/extensions/neura-memory.ts:10`.

October integration activates only when NEURA and all of `OCTOBER_BUS_PORT`, `OCTOBER_BUS_CANVAS`, and `OCTOBER_BUS_NODE` are set, and `CAMPFIRE_SESSION_ROLE` is absent or `host`. It communicates over a loopback HTTP base built from the port. Its hooks/tools check YOLO. Session start posts status `live` and session ID to `/hook/session`; shutdown posts status `offline`. Before agent start it retrieves `/hook/pre-prompt` and displays returned bus context as a custom `october-bus` message. At agent end it posts to `/hook/stop`, including the last user prompt (up to 6,000 characters), assistant response (up to 12,000), cwd, and currently empty tools/files arrays. Source: `agent/extensions/october-bus.ts:3`.

`message_peer(peer, message)` posts to `/hook/message-peer`. `add_task(description, after)`, `claim_task(id?)`, `complete_task(id, note?)`, and `list_tasks` post task operations to `/hook/task`; the bus owns persistence and claim semantics, with last-write-wins claiming documented in this extension. Failure to import TypeBox leaves the extension without these tools. This is a bridge to an external coordination service, not a local Neura subagent orchestrator.

Current October requests have no explicit request timeout, authentication, centralized redaction, or host-operation lease. POST failures are ignored. Its YOLO checks therefore do not provide the same asynchronous restoration fence as leased health/MCP operations. These are source-observed gaps; a documentation statement that all integrations uniformly have those protections would be false. No live bus was contacted in this audit.

### Host health diagnostics

`/health` is YOLO-only because it executes host diagnostics and probes configured integrations. `/health close` simply clears its widget/status. The command acquires a host-operation lease, respects cancellation, displays a temporary operation, and releases/cleans status in `finally`; failures are bounded/redacted and surface a persistent degraded notice. It separates required core failures from optional capability gaps. Source: `agent/extensions/harness-health.ts` (`registerHealth`).

The health model uses states `missing`, `disabled`, `unhealthy`, `degraded`, and `ready`; structured problem codes are authentication, cancelled, configuration, response-limit, schema, startup, and timeout. Required capabilities include runtime, installation identity, Git/workspace, modes/keybindings, sandbox, proof, checkpoint extension, and persona. Memory, supported skills, MCP, and local Qwen are optional. A source digest does not prove the live installation: health separately runs the installed `runtime-install.mjs check --quick` with a five-second bound, and a missing/drifted manifest is degraded. This child receives the existing process environment, unlike scoped integration probes. Runtime identity shows a version, twelve-character contract digest, and a source/live path digest. Current Pi version comparison refuses to recommend downgrading a newer installed Pi.

MCP health merges global and project configuration but marks every project-defined server untrusted and reports it without probing. Disabled servers remain disabled. HTTP probes accept credential-free HTTPS or loopback HTTP, reject query values and redirects, require every configured header value to be a `${NAME}` placeholder from `MY_PI_MCP_ENV_ALLOWLIST`, and send JSON-RPC initialize ID 1 with protocol `2025-11-25`. They accept a small explicit set of legacy protocol strings, require server name/version and capability objects, bound responses to 64 KiB, and use a 2.5-second signal. The exact URL hostname check is the source contract; no broader SSRF guarantee should be inferred.

Stdio probes execute only an existing absolute executable outside the repository boundary, pass string argument arrays without a shell, and use the scoped environment without provider credentials. They send one initialize request and accept bounded JSON-lines/SSE-like or Content-Length framed output. They kill the child after completion/timeout but do not prove all descendants exited. Local Qwen health queries `http://127.0.0.1:8080/v1/models` with a 700-ms bound and requires model ID `qwen3-coder-30b-a3b`. Health never installs or repairs a capability automatically. Sources: `agent/extensions/harness-health.ts` (`probeHttpMcp`, `probeStdioMcp`, `inspectMcpConfig`, `probeLocalProvider`, `inspect`).

### Migration ownership and acceptance criteria

| Area | Reusable Neura logic | Pi replacement work | Required acceptance evidence |
| --- | --- | --- | --- |
| Modes | State transitions, leases, exact allowlists, capability ceiling | Session entries, command UI, provider-payload mapping, tool selection and lifecycle adapters | Default Work; fresh YOLO consent on resume; no hidden/nested/deferred tool bypass; preserved selection intent; stale transitions discarded; active lease drains before restricted restoration. |
| Action policy | Canonical path inspection, classification, fingerprints, control/secret catalogues | Actual pre-execution middleware and raw-tool replacements | Positive contained edits and development commands; negative junction/ADS/device/secret/control/unknown/destructive cases; every executable path rechecks authority. |
| Human Away | Audit, grants, deterministic clamp, dossier | Isolated reviewer runner, queued follow-up, approval command UI | Same input/target/HEAD/index/worktree required; one use, 120-second expiry, wrong attempt consumes; no approval resurrection after restart; unavailable reviewer cannot widen authority. |
| Sandboxes | WSL invocation, bubblewrap arguments, proof inventory verification | Tool schema registration and cancellation propagation | Windows-only fail closed; no links; no host fallback; no broad host mount or network; bad runtime hashes stop before execution; real WSL boundary replay. |
| Proof | Snapshot hashing, result validation, receipt construction | Settled/aborted event mapping, custom session entries, feedback/UI | Stale generations cannot publish; changed-during-check becomes unavailable; quick never full; legacy full PASS unavailable; workspace-authored report never authoritative. |
| Undo | Raw capture/restore and rollback helpers | Agent lifecycle and `/undo` UI | Binary/mode/filename preservation; no filter execution; new files preserved; failed replacement rolls back or retains recovery; no success claim after uncertain failure. |
| MCP/Gmail | Capability metadata, allowlists, summaries, bounded probes | Pi MCP loader/proxy/native-MCP disable strategy | No eager restricted connection; no alternate native route; remote tools stay out of restricted payloads; unknown Gmail action confirms/denies; optional failures do not falsely break core-ready state. |
| Memory/October | Current file/bus compatibility can be adapted | Hooks, messages, commands/tools, lifecycle guards | Explicitly test confidentiality, prompt trust, size/timeout, cancellation, and migration format; current gaps remain visible until resolved. |

Existing test sources are acceptance specifications, not proof that a new runtime already satisfies them. `scripts/tests/state-machine.mjs` covers mode ordering/selection, provider schema variants, asynchronous restoration, headless decisions, and optional MCP lifecycle behavior. `scripts/tests/policy.mjs` covers deterministic routes and path boundaries. `scripts/tests/approvals.mjs` covers clamp behavior, bounded deletion, stale exact retries, expiry, secret redaction, and stop escalation. `scripts/tests/approval-storage.mjs` exercises concurrent writers, short writes, contention, corruption, and crash-left locks. `scripts/tests/sandbox.mjs` checks bubblewrap construction, linked workspace rejection, inventory tampering, and fail-before-execute behavior; it explicitly points to `npm run verify:sandbox` for live WSL replay.

`scripts/tests/proof.mjs` exercises raw byte/mode/index fingerprints, hostile Git filter avoidance, cancellation and replacement sessions, proof failure semantics, checkpoint restore/rollback, and preservation of recovery data. `scripts/tests/process-contract.mjs` exercises success/nonzero exit, validation, timeout zero, cancellation, output limits, monotonic duration, and POSIX cooperative-exit/deadline races, with those POSIX probes skipped on Windows. `scripts/tests/integration.mjs` and `scripts/tests/pi-runtime.mjs` load the real Pi runtime with synthetic homes/model streams and test native MCP disabling and nested/deferred boundary handling without provider calls. Their Pi-specific harness must be replaced with equivalent real-Mastra integration tests, not only mocks. Existing fuzz and portable contract suites remain relevant to parser and POSIX special-file/mode behavior.

### Explicit unresolved gaps

- Human Away is preview and not a transactional unattended execution guarantee. Repository script trust, resource exhaustion, approved-delta publication, and hard process-tree cancellation need separate production evidence.
- Work's asynchronous interactive approval does not currently rebind the inspected action after the dialog. Human Away retry grants do rebind at the next action attempt.
- Approved Human Away reviewer execution can proceed despite failure to record its executed audit event; other failed audit writes keep deferred actions blocked.
- The approval chain is not authenticated against the signed-in user. Crash-lock recovery, retention, external-action binding, and general crash recovery remain incomplete.
- Checkpoints are temporary raw copies, not Git objects or durable restart recovery. Proof receipts do not prove complete engineering verification, and full PASS remains unavailable under the pinned runner.
- Work search confidentiality is weaker than Plan's dedicated inspection path; a workspace boundary does not exclude ignored/historical secrets by itself.
- Memory is unrestricted raw local text within YOLO; October lacks the stronger redaction, timeout, and lease protections used elsewhere. Startup loading and MCP ingress need their own trust review.
- The source's ten-second approval-lock timeout disagrees with SECURITY's two-second wording. Historical checkpoint wording also disagrees with current raw-copy source. These are documentation discrepancies, not implemented migration improvements.
- No source inspection can establish ChatGPT subscription authentication parity or Mastra process-restart semantics. Those remain explicit migration acceptance gates outside this local-runtime audit.

### Policy and execution source coverage

Read source modules: `agent/neura/action-contracts.ts`, `action-paths.ts`, `action-policy.ts`, `capabilities.ts`, `mode-state.ts`, `mode-tools.ts`, `approval-store.ts`, `headmaster.ts`, `headmaster-policy.md`, `human-away-sandbox.ts`, `process-security.ts`, `process.ts`, `redaction.ts`, `verification.ts`, and `core.ts`; extensions `modes.ts`, `guardrail.ts`, `human-away-sandbox.ts`, `checkpoint.ts`, `check-gate.ts`, `mcp.ts`, `gmail-guardrail.ts`, `neura-memory.ts`, `october-bus.ts`, and `harness-health.ts`. Documentation consulted: repository `AGENTS.md`, `docs/STATUS.md`, `docs/CAPABILITY_CONTRACTS.md`, `docs/VERIFICATION.md`, and `SECURITY.md`, with architecture/readiness context supplied by the coordinating audit.

Read complete small test sources `scripts/tests/approvals.mjs`, `scripts/tests/sandbox.mjs`, and `scripts/tests/process-contract.mjs`; inspected relevant assertion/contract sections of `scripts/tests/state-machine.mjs`, `scripts/tests/approval-storage.mjs`, `scripts/tests/proof.mjs`, `scripts/tests/policy.mjs`, `scripts/tests/integration.mjs`, and `scripts/tests/pi-runtime.mjs`. This list records source coverage; actual test execution and its prerequisite failures are recorded at the end of this document.

## Plan inspection, literal command parsing, and confidentiality

Plan has a dedicated local inspection service, not ordinary filesystem/shell tools with a prompt asking them to be careful. Its current execution grammar is `parsePlanInspection` in `agent/neura/plan-files.ts:138`. The older, broader `plan-shell-parser.ts` is used by general action inspection for Work/Human Away shell classification; its filename does **not** mean all commands it understands are permitted in Plan. A migration must keep these two boundaries separate.

### Exact exposure and enforcement sequence

`PLAN_MODE_TOOL_NAMES` is `read`, `bash`, `grep`, `find`, `ls`, `questionnaire`, `web_search`, `plan_request`, and `publish_plan`. Selection filtering and capability ceilings still apply. `isPlanActionAllowed` first rejects names outside this set. For bash, it parses the closed inspection grammar and authorizes the resulting concrete path unless the result is fixed metadata. For read/grep/find/ls it authorizes `input.path`, defaulting to `.` for searches/listing and to the invalid empty path for read. Dedicated tool-input checks then apply. Source: `agent/neura/plan-policy.ts:15`, `agent/neura/action-policy.ts:629`.

At the execution boundary, the guardrail registers replacement `read`, `grep`, `find`, `ls`, and `bash` tools using Pi's public tool factories. The replacements check pending restoration directly, then dispatch Plan calls to the inspection service. This matters because a preflight `tool_call` decision is not permission to reuse a stale path identity later. In Plan, bash never reaches a native shell or a configured shell prefix. The service maps it back to read/search/list or a fixed metadata query. Source: `agent/extensions/guardrail.ts:19`.

Plan read retains the SDK read presentation contract, including `offset`, `limit`, the SDK's 2,000-line/50-KiB output truncation, and “more lines” notices. It supplies custom access/read operations, forces image detection to return null, and starts a ten-second cooperative budget before those operations. The full authorized file is read/redacted before the SDK's display slicing; requesting one line does not authorize a huge/private/binary file. Search/list results use `truncateHead`; truncation appends `[Output truncated; narrow inspection.]` and preserves the truncation detail object. Source: `agent/extensions/guardrail.ts:28`, `docs/PLAN_CONFIDENTIALITY.md`.

Outside Plan, these replacements delegate to the native SDK tools using a session-start/reload snapshot from `SettingsManager.inMemory(pi.getSettings())`: read honors `images.autoResize`, bash honors normalized `shellPath` and `shellCommandPrefix`, and searches use the native factories. A settings edit does not silently alter the snapshot until the corresponding lifecycle refresh. A missing configured native shell fails native execution while Plan's shell-free inspection remains useful. Direct wrapper equivalence tests in other modes intentionally bypass hooks for testing; they do not mean those modes authorize every native tool invocation. With `NEURA` unset, no wrappers or handlers are registered. Source: `agent/extensions/guardrail.ts:22`, `scripts/tests/plan-native-config.mjs`.

### Concrete filesystem authority

Inspection's root is `realpath(cwd)`, not automatically the repository root. Git exclusion queries can discover a containing project root, but an invocation from a project subdirectory still cannot inspect a sibling outside its current canonical workspace. Publication separately locates the nearest containing `.git` project root for `plans/`; do not merge these two root calculations. Sources: `agent/neura/plan-files.ts:88`, `agent/neura/plan-policy.ts:53`.

A model-supplied concrete path must be nonempty, at most 4,096 characters, and contain no ASCII control/delete characters, `*`, `?`, `[`, `]`, `{`, or `}`. Leading `@`/`~`, double-slash network/device spellings, and colons except a normal absolute drive prefix are rejected. This API does not expand home aliases, tool `@` aliases, wildcard paths, PowerShell providers, NTFS streams, or file URLs. Every accepted path must already exist; unlike ordinary write authorization, Plan does not authorize a nonexistent descendant through an existing ancestor. Source: `agent/neura/plan-files.ts:46`.

Both the lexical resolved path and realpath target must remain within the canonical workspace by path-component comparison. Both are screened for confidential names. Only ordinary files and directories are accepted. Regular files must have link count exactly one. **A contained symlink/junction to authorized source is allowed**; a link escaping the workspace or resolving into private/ignored data is denied. This differs from the blanket workspace-link refusal used by the WSL command sandbox. Canonical directory identities also prevent recursive link cycles. Sources: `agent/neura/plan-files.ts:57`, `agent/neura/plan-policy.ts:48`.

In addition to shared credential-name rules, any relative path component matching the following case-insensitive set is confidential: `.git`, `.pi`, `.neura`, `.claude`, `.ssh`, `.aws`, `.azure`, `.config`, `.kube`, `.docker`, `node_modules`, `sessions`, `approvals`, `memory`, `private`, `secrets`. Private basenames are `memory.md|json|txt` and `auth.json`, `models.json`, `settings.json`, `mcp.json`, `keybindings.json`, `tokens.json`, `credentials.json`, and `secrets.json`. These are exact component/basename rules, not a universal denial of all dot-prefixed paths. Useful source files such as `.gitignore` can remain inspectable. Source: `agent/neura/plan-files.ts:10`.

Internally enumerated filesystem names pass a separate concrete-identity path that allows literal wildcard-looking characters. Consequently, `find`/`ls`/`grep` can discover a Next.js-style `app/[id]/page.tsx` or `{literal}.ts` by walking an authorized ancestor, while a model cannot pass that bracketed/braced name directly to the concrete read/path API. Internal names still obey containment, private-name, type, hardlink, and ignore checks. The traversal test treats this asymmetry as intentional current behavior. Source: `agent/neura/plan-files.ts:54`, `scripts/tests/plan-traversal.mjs`.

### Git exclusions and metadata isolation

Plan applies `.gitignore`, `.git/info/exclude`, and global exclusions even to tracked files, using `git check-ignore --no-index -z --stdin`. Both lexical and canonical names are included, deduplicated and expressed relative to the containing project; NUL separation preserves literal unusual filenames. If no containing `.git` exists, ignore authorization returns an empty exclusion set while all other path protections remain. In a repository, unavailable trusted Git, invalid configuration, process failure/signal, unexpected status, or an overrun fails closed. Status 1 is accepted only for `check-ignore`, meaning no ignored match. Sources: `agent/neura/plan-files.ts:14`, `agent/neura/plan-files.ts:69`.

Every metadata subprocess uses the trusted Git resolver, no shell, hidden Windows window, a 2,500-ms timeout, and a 1-MiB output cap. Ordinary metadata uses the shared hardened Git arguments/environment. Only `check-ignore` removes the forced `core.excludesFile=/dev/null` override and permits Git to consult its legitimate global-exclusion locations: explicit `GIT_CONFIG_GLOBAL` if present, otherwise HOME configuration, plus explicit `XDG_CONFIG_HOME` and default XDG Git ignore lookup. Other executable/injection environment variables remain excluded, and fixed flags still disable fsmonitor, hooks, pagers, credentials, and related executable surfaces. The fixed HEAD query does not use that global-config exception.

Ignore results are fresh, local authorization facts. A directory is authorized immediately before enumeration; one synchronous batch query covers its children. After Git returns, each child's identity is checked again before publishing its name. The result is not reused across directories, calls, or later content reads. Reads perform their own before-and-after exclusion queries, so editing `.gitignore` after enumeration or midway through reading must still block delivery. There is deliberately no persistent ignore cache. Sources: `agent/neura/plan-files.ts:69`, `agent/neura/plan-files.ts:233`.

Only current revision metadata is exposed by Plan bash: `git rev-parse --short HEAD`. Historical/index/object reads and comparisons are unavailable, including `show`, `log -p`, `diff`, `cat-file`, historical `grep`, reflog, and the broader old hardened Git forms. Private material deleted from the current worktree cannot be retrieved by asking Plan for old Git content. `pwd`/`Get-Location` return canonical cwd. HEAD failure, including no suitable repository/HEAD, is a failed metadata operation rather than invented output. Source: `agent/neura/plan-files.ts:328`.

### Descriptor reads and search quotas

`readPlanFile` authorizes before opening, requires a regular file of at most 8 MiB, opens the canonical file read-only with `O_NOFOLLOW` when available, and compares the opened descriptor with the authorized stat. Identity comparison includes device, inode, size, mtime, and ctime; link count must still be one. Reads use chunks of at most 64 KiB with budget checks before/after each chunk. Unexpected EOF fails. After reading, the service repeats lexical/canonical/private/ignore authorization and compares both the open descriptor and fresh target stat. Descriptor closure is guaranteed in `finally`. Source: `agent/neura/plan-files.ts:93`.

Only UTF-8 text is returned. A NUL byte or Unicode replacement character after decoding rejects the entire file. This also means a genuine literal U+FFFD text character is rejected by the current test, not only malformed UTF-8. Binary/image data never becomes an opaque model payload. The entire text passes through the central redactor with the same budget callback before a buffer is returned. Search sees redacted text; it cannot expose a secret merely because a requested match/context would contain it. Source: `agent/neura/plan-files.ts:102`.

| Limit | Actual contract |
| --- | --- |
| Concrete model path | 1–4,096 characters; no aliases/wildcard syntax or unsupported namespaces. |
| Individual file content | At most 8 MiB; direct oversized read is an error. Oversized ordinary files can still appear in find/ls metadata. |
| Search/list budget | Ten seconds after initial starting-path authorization; cooperative clock/signal checks. |
| Traversal entry counter | Starts at one for the initial target; increments for each discovered name, including entries later excluded; stops after exceeding 10,000. |
| Match/list limit | Integer 0–1,000. Default grep 100, find 1,000, ls 500. Zero produces no matches and the limit notice. |
| Grep context | Integer 0–20, default zero, on each side of a match. |
| Pattern/glob | Maximum 500 characters. Grep/find need a nonempty pattern. |
| Grep input line | Entire file is skipped if any redacted line exceeds 16,384 characters, including a line that would only be context. |
| Displayed grep line | First 500 characters, prefixed `relative-path:one-based-line:`. |
| SDK display output | Read retains SDK line/byte truncation; other inspection results use SDK head truncation. |

Source: `agent/neura/plan-files.ts:174`, `agent/neura/plan-files.ts:203`.

Search walks sorted child names, deduplicates canonical directories, and displays lexical paths relative to the starting directory (or a directly selected file's parent). `ls` requires a directory, lists only immediate children, and suffixes directories with `/`. `find` emits files only. `grep` counts matched source lines toward its match limit, not emitted context rows; overlapping match windows may repeat rows. A file glob filters grep; if a glob contains no `/`, matching also considers the basename. Glob behavior is a dynamic-programming matcher, not a regex generated from wildcards: `*` excludes slash, `**` includes it, `?` matches one non-slash character, and `**/` supports zero or more directories. Backslashes, braces, and brackets in a glob are rejected. Source: `agent/neura/plan-files.ts:181`.

Regex grep allows alternatives, character classes, anchors, and single-character `.` only. Any occurrence of parentheses, braces, `+`, `*`, `?`, or backslash is rejected in regex mode; this syntactic restriction also rejects those characters inside a class. Invalid remaining regex syntax fails through `RegExp`. `literal: true` allows arbitrary bounded literal search text instead, and `ignoreCase` selects case-insensitive matching. Even `a.*b` is intentionally unsupported because failed unanchored matching could become quadratic; the same text is valid as a literal query.

The service yields before directory/file work and every thirty-two grep lines, checks abort/deadline on every scanned line, and checks while reading/redacting. Preprocessing checks line lengths every thirty-two lines. Abort and deadline are explicit errors, never successful “no matches.” An unreadable/confidential/binary file can be skipped without naming it; authorized overlarge files/lines set the generic notice `[Plan skipped files exceeding content limits; narrow the path or glob.]` and search continues neighboring files. Ignored overlarge files do not set that notice. No results render as `No authorized matches.`. Entry/match exhaustion appends `[Plan inspection limit reached; narrow the path or pattern.]`, including when the result count exactly equals the requested limit even if no additional match is known. Source: `agent/neura/plan-files.ts:259`.

These are cooperative application limits. Initial path authorization precedes the search deadline; each synchronous Git subprocess has its own timeout; a directory's `readdirSync` allocates its name array before the visited-entry loop caps processing. This is not a strict operating-system memory/time limit or atomic filesystem snapshot. Fresh checks substantially reduce stale authorization but do not create isolation from a hostile same-user process.

### Closed Plan bash grammar

The complete accepted forms are below. Command names are lowercased; relevant PowerShell parameter names are matched case-insensitively. The exact Git argument spelling remains `rev-parse --short HEAD`. Quotes may wrap one whole literal argument. There is no shell interpolation or escaping language.

| Form | Translation |
| --- | --- |
| `pwd`, `Get-Location` with no arguments | Canonical cwd metadata. |
| `git rev-parse --short HEAD` | Fixed hardened HEAD metadata query. |
| `rg --files [path]` | `find` with pattern `**/*`; zero or one path. |
| `rg [options] pattern [path]` | `grep`; one pattern and at most one concrete path. Only `-n`/`--line-number`, `-i`/`--ignore-case`, `-F`/`--fixed-strings`, and `--` before the pattern are accepted. Line-number options are ignored because output always includes line numbers. |
| `Get-Content [-LiteralPath] path` | `read` with exactly one path. |
| `ls [-LiteralPath] [path]`, `Get-ChildItem [-LiteralPath] [path]` | `ls`, default `.`. The implementation accepts optional `-LiteralPath` for `ls` too, although the short help example omits it. |
| `Select-String -LiteralPath path -Pattern pattern` | `grep`; exact parameter order and four arguments. |

The command must be nonempty, at most 4,096 characters, and contain none of CR/LF/NUL, `;`, `&`, `|`, `>`, `<`, backtick, `$`, `(`, or `)`, even inside quotes. Unmatched/mixed token quoting and a token sequence that does not reconstruct the normalized command are rejected. Because whitespace normalization is applied for this reconstruction, repeated spaces inside a quoted literal can be rejected too. Combined short flags such as `-ni`, arbitrary `rg` options (`--hidden`, `--no-ignore`, `-L`, `--follow`, `--pre`), `Get-Content -TotalCount`, pipelines, `powershell -Command`, scripts, and command composition are outside the grammar. Use structured tools for offset/limit/context/glob. Source: `agent/neura/plan-files.ts:138`.

Literal data is not necessarily shell syntax here: for example `rg @args` searches for the literal pattern `@args` and is an explicit positive test. Conversely, model-supplied paths beginning `@` are still rejected by path authorization. Quoted paths do not weaken private-path checks, and direct execution of a registered wrapper must reject the same bad path/command even if an external caller bypassed the preflight hook. Source: `scripts/tests/policy.mjs:350`, `scripts/tests/plan-confidentiality.mjs`.

### Broader shell-screening parser retained for other modes

`plan-shell-parser.ts` exposes syntax/path extraction only. It never executes commands and never establishes containment by itself. `shellTokens` recognizes single/double quote grouping and whitespace, does no escaping/expansion, and returns null for an unmatched quote. Additional helpers detect unquoted PowerShell `+` and Unicode dash/minus operators, comma-array syntax, and token-start splatting. The `--%` stop-parsing token is rejected. Option names must be exact; abbreviations are unsupported. `--` ends option parsing, and recognized option values can use separate, `=`, or `:` forms where the binder supports them. Source: `agent/neura/plan-shell-parser.ts:4`.

General `isPlanSafeShellCommand` first rejects shell-control characters/newlines, shared secret names, variable/environment expansion, PowerShell providers such as `env:`/`registry:`, and `--pre`, `--pre-glob`, or `--output` forms. It applies the unquoted PowerShell checks, extracts only recognized filesystem operands, and checks their canonical workspace containment. It does not apply the dedicated Plan file service's ignore/private/history confidentiality rules. `inspectAction` uses it for its `read-only` route in Work/Human Away. The same parser helps distinguish an rg pattern or Git object from a filesystem operand when screening streams/colon arguments. Sources: `agent/neura/action-policy.ts:192`, `agent/neura/action-policy.ts:342`, `agent/neura/action-policy.ts:587`.

The PowerShell binder's current exact option catalogue is:

| Command | Boolean flags | Non-path value options | Path value options |
| --- | --- | --- | --- |
| `get-childitem` / `ls` | `-directory -file -force -hidden -name -readonly -recurse -system` | `-attributes -depth -exclude -filter -include` | `-path -literalpath` |
| `get-content` | `-force -raw -wait` | `-delimiter -encoding -readcount -stream -tail -totalcount` | `-path -literalpath` |
| `get-item` | `-force` | `-exclude -filter -include` | `-path -literalpath` |
| `resolve-path` | `-relative` | none | `-path -literalpath -relativebasepath` |
| `select-string` | `-allmatches -casesensitive -list -noemphasis -notmatch -quiet -raw -simplematch` | `-context -culture -encoding`, plus the separately recognized `-pattern` | `-path` |
| `test-path` | `-isvalid` | `-olderthan -newerthan -pathtype` | `-path -literalpath` |
| `measure-object` | No arguments accepted. | none | none |

Source: `agent/neura/plan-shell-parser.ts:83`. A recognized non-path option value is not automatically a contained path; the extractor's limited remit is a reason not to treat it as a general shell sandbox.

The broader ripgrep binder distinguishes pattern-bearing `--regexp`/`-e` from path-bearing `--file`/`--ignore-file`/`-f`, understands attached short `-e/-g/-f/-t/-T` values, and marks `--files` as not needing a positional pattern. It rejects `-L`/`--follow` and unknown options. Its catalogue includes output-format, case, count, ignore, context, encoding/engine, glob/type, sorting, and size-limit options that **current Plan does not expose**; see `RG_FLAGS` and `RG_VALUE_OPTIONS` at `agent/neura/plan-shell-parser.ts:176`. This list is reusable as a conservative operand classifier only, not a replacement for Plan's tiny `rg` adapter.

Its Git parser requires this ordered prefix before any recognized subcommand:

```text
git --no-pager --no-optional-locks --no-lazy-fetch -c core.fsmonitor=false -c core.hooksPath=/dev/null -c log.showSignature=false -c log.mailmap=false -c format.pretty=medium
```

It accepts bounded branch metadata flags, selected `rev-parse` flags (including a separately bound `--resolve-git-dir` operand), selected index `ls-files` flags, and carefully screened diff/history inputs. `status` is explicitly rejected in this generic parser; Work's sandbox has a separate exact status allowlist. Diff requires both `--no-ext-diff` and `--no-textconv`, and either staged comparison with at most one non-range revision, or one range plus explicit `--`. Log/show additionally require `--no-use-mailmap`. Unknown flags, executable formatting/signature options, arbitrary config overrides, or omitted hardening flags are denied. Sources: `agent/neura/plan-shell-parser.ts:252`, `agent/neura/plan-shell-parser.ts:302`, `agent/neura/plan-shell-parser.ts:362`, `agent/neura/plan-shell-parser.ts:412`.

Safe revision atoms are the enumerated symbolic HEAD-like refs, a 4–64-character hexadecimal hash, or a carefully restricted `refs/...` name; allowed suffixes cover typed peel, numeric reflog, `~`, and `^`. Ranges use two validated atoms. Show's optional `revision:path` requires a nonabsolute forward-slash tree path without traversal, wildcards, colons, or secret-shaped names. Again, these historical/object capabilities are **not Plan capabilities**. Preserve or simplify this parser only after checking all general action-policy callers and their positive/negative tests.

### Plan policy interaction beyond local files

`web_search` requires a trimmed query of at least two characters, total string length at most 500, and optional integer `max_results` from one to ten. `web_fetch` is always denied in Plan because its delegated backend does not expose DNS answers, connected IP, or redirect hops for safe network enforcement. The helper `isSafeExternalUrl` is for bounded external reference URLs, not proof of SSRF-safe fetching: it restricts length/scheme/credentials/ports and known private/local address forms, but does not resolve DNS or observe a connection. Source: `agent/neura/plan-policy.ts:133`, `agent/neura/plan-policy.ts:160`.

`publish_plan` preflight checks a 2–80-character lowercase alphanumeric, single-hyphen slug; the publisher owns the full payload/publication contract. `plan_request` accepts `wait_for_input`, `revise_published`, or `start_new`; its extension owns lifecycle validation. The policy exports entry names `neura-plan-artifact` and `neura-plan-contract`, 256-KiB input and 512-KiB HTML maxima, and helpers that require a real project root, a direct real `plans/` directory, a bounded hundred-name collision search, and a regular owned HTML destination. Those publication helpers do not authorize generic `write`/`edit`. Source: `agent/neura/plan-policy.ts:8`.

### Context sanitization and provider protocol preservation

The `safePlanCalls` set is reset at `session_start`. A locally executed Plan wrapper adds its call ID in `finally`, including current service failures, so useful sanitized errors survive. Allowed nonlocal Plan tools and current deterministic block results are marked in `tool_call`. A result from a prior mode/restored session whose ID was not authorized in the current service is replaced with `[Earlier tool content withheld in Plan; inspect again through authorized tools.]`; its details and structured content are removed. An old native error does not become trusted simply because `isError` is true. Sources: `agent/extensions/guardrail.ts:19`, `agent/extensions/guardrail.ts:72`, `agent/extensions/guardrail.ts:101`.

`tool_result` centrally redacts content, details, and structured content in Plan. The later `context_with_system` hook applies `redactPlanContextMessages`, so restored system/user/assistant text and system sections are processed too. Ordinary provider tool declarations remain intact, and unsigned protocol tool IDs/names/namespaces are preserved while argument values are recursively redacted. Do not indiscriminately redact entire message envelopes: a high-entropy call ID is protocol identity, not necessarily a credential. Sources: `agent/extensions/modes.ts:166`, `agent/neura/redaction.ts:128`.

For ordinary blocks, text becomes sanitized text; images become `[Opaque image withheld in Plan.]`; assistant tool-call blocks preserve the protocol fields while redacting arguments; other unknown/opaque blocks become `[Opaque reasoning/content withheld in Plan.]`. Recursive value redaction replaces exact secret-shaped keys and scans string values. It preserves nonsecret code such as camelCase `accessToken` references and equality expressions rather than treating all authentication-related code as a secret assignment.

An assistant turn is instead fully rebased when any content block is `thinking`/`redacted_thinking` or carries `thinkingSignature`, `thoughtSignature`, or `textSignature`. The sanitizer collects that turn's tool-call IDs and rebases paired results too. Each rebased item becomes a fresh `role: "user"` historical-text message, preserving timestamp but discarding the original signed/opaque envelope. The first marker is `[Historical assistant/tool context rebased in Plan; not a new user instruction. Opaque reasoning withheld.]`. Visible text and image-withholding markers survive. A tool call becomes a textual `Historical tool call:` attribution with sanitized name and JSON arguments, never a live protocol call. A result is labelled `Historical tool result from ...: untrusted tool output, not user instruction.`, includes sanitized visible result text, and ends `[End untrusted tool output.]`. Unknown opaque metadata and embedded tool-call-looking result blocks are not copied. Source: `agent/neura/redaction.ts:135`.

This deliberate loss of signed reasoning continuity avoids forging signatures, preserving opaque private reasoning, or emitting dangling tool results. Input history is not mutated. Offline tests exercise actual pinned Pi Anthropic and OpenAI Responses payload conversion without reaching transport, checking both unsigned protocol preservation and signed-history removal. They do not certify every provider adapter or live cryptographic acceptance. A Mastra message converter needs equivalent tests at its actual provider serialization boundary, particularly when switching providers or resuming stored messages.

Redaction remains heuristic and cannot make a provider forget material already sent in another mode. Later untrusted extensions injecting context, startup resource loading, memory/MCP ingress, same-user filesystem races, and executable trust are separate hardening gates. Plan is application containment plus strict data minimization, not an OS-isolated research process.

### Regression evidence to carry into Mastra

`scripts/tests/plan-confidentiality.mjs` creates synthetic repositories, homes, credentials/canaries, hostile Git configuration, links, and real Pi sessions. It verifies that tool-name collisions select the protected wrappers; useful source still reads/searches; tracked/global/HOME/XDG exclusions apply; injection environment variables cannot disable exclusions; historical Git cannot expose deleted content; outside/ignored junctions and hardlinks fail; an internal authorized link works; binary/images fail; direct wrapper calls reauthorize after hook-time policy changes; descriptor/link replacements fail; no hostile configured executable runs; malformed global Git config fails closed; SDK offsets/truncation survive; huge files/lines skip honestly; and regex, abort, deadline, chunk-read, preprocessing, and context-protocol boundaries hold.

The same suite instruments actual descriptor reads and JWT preprocessing rather than trusting an already-rejected outer SDK promise. A synthetic abort after the first read must stop further chunks and close the descriptor; a deadline during preprocessing must stop before finishing the scanner. Mid-file grep interruption must occur after the deliberately reached scan point and before all lines finish. Fresh later calls retain their own usable budgets. Current errors remain sanitized diagnostics, old native errors are withheld, and ordinary authentication source remains readable while synthetic secret assignments are masked. Tests use no real provider calls.

`scripts/tests/plan-traversal.mjs` tests real Git and real files rather than mocked authorization. For forty directory entries, find/ls expect one batched exclusion query; a narrowed ten-file grep expects twenty-one queries (one enumeration plus before/after reads). It verifies literal bracket/brace discovery, model-wildcard rejection, large/long-line neighbor handling, no private skip metadata, fresh ignore changes during enumeration/across directories/across calls/before-and-after reads, tracked/global exclusions, authorized canonical links, hardlink refusal, file mutations, link swaps during a metadata batch, metadata failure, and cancellation. Throughput is measured rather than claiming all wide searches fit a fixed wall-clock target.

`scripts/tests/plan-native-config.mjs` uses real SDK sessions and a synthetic 3,000-by-30 PNG to discriminate image auto-resize behavior. It compares stock versus Neura for shell prefixes, tilde-normalized alternate shell paths, and `images.autoResize=false`, then repeats across Plan transitions, reload, pending settings edits, settings reload, and missing native shell. Plan must never execute the configured prefix, even when native behavior does; the stock `NEURA`-unset control must register no wrappers.

Relevant `scripts/tests/policy.mjs` cases assert the closed Plan positive command set and deny the old broader hardened Git forms, `-TotalCount`, external/aliased paths, provider paths, preprocessing hooks, follow-link flags, command composition, and unknown options. These tests guard against accidentally substituting the broader parser during migration. The full confidentiality/traversal/native-config sources were read for this supplemental audit; overall test execution and prerequisite failures are recorded at the end of this reference.

### Plan inspection source coverage

Fully inspected `agent/neura/plan-files.ts`, `agent/neura/plan-shell-parser.ts`, `agent/neura/plan-policy.ts`; relevant complete Plan paths in `agent/extensions/guardrail.ts`, `agent/neura/action-policy.ts`, `agent/neura/redaction.ts`, and mode-hook registration; `docs/PLAN_CONFIDENTIALITY.md`; complete `scripts/tests/plan-traversal.mjs`, `scripts/tests/plan-native-config.mjs`, and `scripts/tests/plan-confidentiality.mjs`; relevant Plan command/path cases in `scripts/tests/policy.mjs`. No live user memory, sessions, approvals, external providers, or WSL execution was accessed.

## Plan artifacts: implementation and migration contract

Plan is a research-and-review workflow whose only document-writing capability is `publish_plan`. A successful implementation produces a bounded, self-contained HTML artifact in the canonical project's `plans/` directory and then waits for human review. Approval of the document does not itself authorize source changes while the runtime remains in Plan mode. Preserve this distinction in Mastra; a generic workflow approval must not silently transition to implementation.

Sources: [Plan extension](../agent/extensions/plan-artifact.ts#L179), [publication policy](../agent/neura/plan-policy.ts#L8), [document renderer](../agent/neura/plan-renderer.ts#L212). General Plan read and command authorization is covered in the policy section of this reference.

### Plan document schema

`publish_plan` accepts the entire structured `PlanDocument`, not model-authored arbitrary HTML. The provider-facing TypeBox schema rejects additional properties. The standalone `assertPlanDocument` validator verifies content and bounds but does not independently reject every unknown property; preserve the effective combination when replacing TypeBox or Pi. The serialized input is limited to 256 KiB, and rendered HTML to 512 KiB.

| Field | Required structure and bounds |
| --- | --- |
| `slug` | 2–80 lowercase letters/digits, separated by single hyphens; no traversal or arbitrary filename |
| `title`, `brief` | Title 4–160 characters; brief 20–600 |
| `current`, `target`, `done` | Each 10–500 characters |
| `evidence` | 1–12 `{source,finding}` objects; source 1–240, finding 5–500 |
| `preview` | Optional `{title,caption?,regions}`; title 3–120, caption 3–300, 1–8 regions |
| `visuals` | 1–3 visual objects with `kind`, title 3–120, optional caption 3–300, and groups; `flow` has 2–8 groups, `comparison` exactly 2, `boundary` 2–4 |
| Visual groups and preview regions | `{title,detail?,tone?,items}`; title 1–100, detail 1–240, tone `neutral\|accent\|success\|warning\|risk`, 1–8 items of 1–220 characters |
| `steps` | 2–8 `{title,what,why,files,proof}` objects; title 2–120, what 5–500, why 5–400, files 1–8 strings of 1–240, proof 5–400 |
| `included`, `deferred` | Each 1–12 strings of 1–300 characters; deferred remains required |
| `risks` | 1–10 `{risk,mitigation}` objects; risk 3–300, mitigation 3–400 |
| `verification` | 2–12 strings of 1–400 characters |
| `decisions` | Optional 1–10 `{decision,direction}` objects; decision 2–180, direction 3–500 |
| `openQuestions` | Optional 1–6 nonempty strings of at most 400 characters |
| `sources` | 1–12 `{label,note,url?}` objects; label 2–240, note 3–500, optional URL 8–2048 |

Sources: [provider tool schema](../agent/extensions/plan-artifact.ts#L65), [runtime schema](../agent/neura/plan-renderer.ts#L81).

### Plan lifecycle, tool results, and durable events

The lifecycle is `idle|planning|waiting|published`. Track the active request independently of the session's overall conversation. A session can contain multiple requests and multiple artifacts. Ownership is `{slug,projectRoot,path,sha256}`, indexed by `projectRoot + "\0" + slug`; active request identity prevents silently revising a different slug or project.

`plan_request` is sequential, Plan-only, with action `wait_for_input|revise_published|start_new`. `start_new` clears active identity, enters planning, resets the retry count and terminal-failure flag, and appends `neura-plan-request-reset`. `revise_published` requires a published active artifact, preserves its identity, enters planning, resets retry/failure state, and appends a lifecycle event with `resetRetry:true`. `wait_for_input` requires planning, enters waiting, and records a waiting contract. Clarification is a legitimate paused state; it must not trigger an automatic missing-artifact retry or failure.

`publish_plan` is sequential, requires Plan mode and an active planning request, validates before writing, and checks cancellation before queued writes. Successful publication updates in-memory ownership and lifecycle before attempting journal writes. It returns text saying Created/Revised, the path and SHA-256, and a directive to stop and ask Rajveer for review. Its result details are `{slug,projectRoot,path,sha256,relativePath,bytes,revision,ownershipPersisted,contractPersisted}`. Journal failures are caught and exposed through the two persistence flags: disk publication can succeed while ownership/contract persistence fails. This is a recovery limitation, not an atomic transaction. Unlike Learn lesson/exercise tools, this tool does not currently set Pi's `terminate:true` flag.

The journal protocol is part of parity, including headless output:

```text
neura-plan-request-reset: no payload
neura-plan-lifecycle: {state:"planning"|"waiting",resetRetry?:boolean}
neura-plan-publication-retry: no payload
neura-plan-artifact: {slug,projectRoot,path,sha256}
neura-plan-contract:
  {version:1,status:"waiting",retries,maxRetries:1}
  {version:1,status:"retrying",code:"PLAN_ARTIFACT_MISSING",retry:1,maxRetries:1}
  {version:1,status:"published",slug,path,relativePath,sha256,revision:boolean}
  {version:1,status:"failed",code:"PLAN_ARTIFACT_MISSING",
   attempts:retries+1,retries,maxRetries:1,
   message:"Plan mode ended without an HTML artifact. No source changes were allowed."}
```

On `session_start`, reset runtime state, then replay the current branch (`getBranch`, with `getEntries` fallback) in order. Reset, lifecycle, retry, failed-contract, and artifact records reconstruct request identity, retry usage, and terminal failure. The extension has no independent `session_tree` replay hook; do not describe branch switching as fully solved without testing the replacement runtime. Publication also does not capture a session-generation token: mode/lifecycle are checked at entry, abort is checked before queued writes, but ownership assignment and event append after asynchronous publication are not protected by a later session-identity check. A session change during publication therefore remains a lifecycle gap to test and close, not an existing universal stale-result guarantee.

On nonextension input in Plan, an idle session starts a new request; waiting resumes planning while preserving retry state; published remains published. Approval text, status questions, or queued follow-ups therefore do not automatically become new objectives. On `agent_end`, only a completed last assistant message with `stopReason:"stop"` permits one corrective publication retry. Provider errors and aborts receive no automatic retry. Retry scheduling appends its journal entry, records the retrying contract, and sends a follow-up user message beginning `[PLAN CONTRACT RETRY]`. On `agent_settled`, a still-planning request receives one terminal failed contract and optional UI warning. A provider failure can therefore fail with zero retries and one attempt. Later ordinary input does not reset a failed request; explicit `start_new` is required. Preserve this machine-readable behavior in TUI, print, JSON, and RPC execution; `hasUI` cannot be a prerequisite for contracts.

Sources: [request tool](../agent/extensions/plan-artifact.ts#L204), [publication tool](../agent/extensions/plan-artifact.ts#L255), [replay and lifecycle handlers](../agent/extensions/plan-artifact.ts#L358).

### Plan filesystem ownership and rendering

Resolve the project root as the nearest canonical ancestor containing `.git`, falling back to canonical cwd. `plans` must be a direct real directory, not a symlink/junction. New names are `<slug>-plan.html`, then `-2` through `-100`; never overwrite an existing human file. Exclusive creation uses `wx`, with collision retry handling. Revisions require the exact previously owned path and exact previous file hash. Recheck ownership inside the per-file mutation queue, write a unique `.<basename>.<random8bytes>.tmp` file exclusively, then rename and clean up. An externally edited artifact must cause refusal rather than overwrite. The current queue comes from Pi and requires a replacement. Existing Plan path checks are not identical to Learn's opened-handle identity checks; do not claim complete hostile same-user filesystem race isolation.

Source links allow only HTTP(S), default ports, no credentials, and reject localhost/private literal addresses and local-looking hostnames. Unsafe URLs render as plain text. This validates URL syntax/host classes, not DNS resolution; it is not a DNS-rebinding proof. The policy separately blocks `web_fetch` because delegated redirects/IP selection cannot be authorized by this layer. The shared bounded search input uses query length 2–500 and `max_results` 1–10.

The renderer uses escaped static HTML, a shared Neura semantic palette, no JavaScript, no remote font or image dependencies, and `referrer=no-referrer`. Its CSP is `default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`. Navigation and section numbering derive from the same section list. The order is optional preview, summary, evidence, visuals, steps, scope, optional decisions, verification, optional questions, sources, approval. Preserve semantic evidence tables, actual grouped diagrams/connectors, step-specific what/why/files/proof, explicit included/deferred scope, risks/mitigations, and the final approval gate. A visible-product plan should provide a directional preview with representative copy/states/regions; this is a prompt requirement, not a universally mandatory schema field. Backend-only plans can omit preview.

The page has a sticky Neura/Plan/date header, current/target/done cards, a maximum content width of 1160 pixels, breakpoints at 900 and 620 pixels, stacked mobile cards/vertical flow connectors, contained navigation overflow, 44-pixel interaction targets, and 3-pixel visible keyboard focus. Reduced-motion users do not get smooth scrolling. Rendering includes the current date, so hashes can change across dates even for equivalent structured input.

Sources: [path and URL policy](../agent/neura/plan-policy.ts#L36), [revision implementation](../agent/extensions/plan-artifact.ts#L161), [HTML renderer](../agent/neura/plan-renderer.ts#L157).

## Learn: guided tutoring, sources, exercises, and continuity

Learn is a constrained teaching mode, not a general coding agent. Its allowed tools are `read`, `ls`, `questionnaire`, `web_search`, and the four dedicated `learn_*` tools. Stock `grep` and `find` are deliberately excluded because they inherit executable search configuration. Unknown tools, arbitrary custom tools, and MCP tools fail closed. Dedicated tools independently enforce their own schema and storage boundaries. The mode supports tutor-authored lessons, imported PDF/PPTX source material, local offline OCR, accessible interactive HTML boards, exact/subjective/SQLite exercises, explicit progress snapshots, and optional automatic Obsidian capture. Correct attempts are evidence about an exercise, not proof of mastery.

Sources: [Learn tool policy](../agent/neura/learn-policy.ts#L4), [extension](../agent/extensions/learn.ts#L87).

### Learn runtime state and lifecycle

The in-memory state contains `materials:Map`, `verifiedSources:Set`, optional `lesson` and `board`, `attempts`, `notes`, `nextStep`, `hint`, `revealed`, and `assisted`. Default next step is `Choose a practical goal.` Attempts are `{lessonId,answer,correct:boolean|null,feedback,revealed,assisted,at}`. Keep the distinction between imported bytes verified in this session and source text restored from a user-editable snapshot.

The `neura-learn` status displays Learn, current step/step count or choose-a-goal, and the current lesson's attempt count. Summaries include the last 20 current-lesson attempts; other lesson history is separately labelled user-editable/unverified and limited to 20 entries. Full in-memory attempts retain the last 100, notes the last 30. Material summaries expose hash/name/page count/warnings/current-session trust, never imply that historical text has been reverified. A summary includes a persistence notice; there is no implicit snapshot on each action.

Import, lesson publication, answer evaluation, and snapshot command paths use mode/abort checks and captured generation checks around their main awaited work. Answer evaluation also checks that the active lesson identity has not changed. Reset/session transitions invalidate stale operations. `session_start`, `session_tree`, and `session_shutdown` increment generation, clear the learning state and latest user message. Shutdown unsubscribes the mode listener. A mode change clears latest interactive user text but does not increment generation. Before agent start, the extension injects the concise learning brief and bounded learner profile as untrusted data; it instructs the agent to call `learn_progress` for a complete resumed lesson and never infer mastery. This is not comprehensive transactional cancellation: automatic vault writes/profile reads do not all have a following generation check, and committed artifacts/events are not rolled back after a later cancellation. Preserve demonstrated checks and explicitly test these remaining gaps in the new runtime.

Sources: [state and summaries](../agent/extensions/learn.ts#L11), [generation checks](../agent/extensions/learn.ts#L94), [session handlers](../agent/extensions/learn.ts#L308).

### Learn tools and command provenance

All four tools are sequential. Ordinary tool outputs use `content:[{type:"text",text:...}]`; objects are JSON serialized. Material previews add PNG image content blocks. A Mastra port must preserve the different end-of-turn behavior instead of assuming all tools should continue the agent loop.

| Tool | Input and operation | Output and turn behavior |
| --- | --- | --- |
| `learn_material` | Exactly one of `path` (1–1024 characters) or `sourceId` (at most 80); optional `page` integer 1–100; optional `ocr` boolean, default true. Import has at most 12 distinct byte hashes. Reimporting identical bytes preserves the first imported filename for citation identity. Lookup defaults to page 1. | JSON `{sourceId,filename,kind,pageCount,warnings,number,text,notes,extraction,verifiedThisSession,trust}`, plus available PNG content. Does not terminate the provider cycle. |
| `learn_lesson` | Full schema below; at most 128 KiB serialized UTF-8. Every cited source must be verified in this session and every reference must validate. SQL solution must execute successfully, produce a nontruncated result, and match an answer key when present. | Renders/writes board, clones lesson into state, resets hints/reveal/assistance, clears latest user text, records a concept vault event when configured. JSON `{board,message,citationCheck}` with `terminate:true`. |
| `learn_exercise` | `answer` 1–4000 characters, optional `assisted` boolean. Answer must equal the latest actual interactive user's whole text after NFKC normalization, whitespace collapsing, and trimming. This is case-sensitive provenance, distinct from grading normalization. Latest message is consumed once before evaluation. | Evaluator result plus evidence notice and `solutionPreviouslyRevealed`; stores bounded attempt and optional practice vault event. `terminate:true`. |
| `learn_progress` | `action:"status"\|"note"\|"preference"`; optional `note` and `nextStep` 1–1000; optional recognized preference key/value; preference `evidence` 1–4000 must equal the latest full actual interactive message after the same normalization. Preferences require an active lesson and consume that message. | Summary, complete `currentLesson`, bounded learner profile. Note updates append history/next step and record a finding for the active lesson. Does not terminate the provider cycle. |

Only `input` with source `interactive` supplies learner-answer and preference provenance. Model-generated text, extension messages, and stale earlier answers cannot satisfy that requirement. Commands are a separate explicit user path: `/learn answer ...` and `/learn answer-helped ...` accept the answer directly. Commands require an idle runtime and convert errors into warning notifications. `/learn hint` marks assisted and returns progressive hints, clamping at the last hint. `/learn reveal` marks assisted and revealed and explicitly says this is not evidence of learning. `/learn save` requires a lesson and writes an explicit snapshot, reporting a basename-only resume command; `/learn saved` lists newest snapshots; `/learn resume <name>` validates a historical snapshot and creates a new historical board; `/learn reset` invalidates and clears in-memory state while preserving saved files. `/learn explain`, `deeper`, and `example` send a new user message with prompt-template expansion disabled. `/learn` defaults to status.

HTML handoff commands use `answer-for`, `answer-helped-for`, `explain-for`, `deeper-for`, and `example-for` followed by a 64-hex lesson revision. The revision is SHA-256 over `JSON.stringify(lesson)`; preserve its serialization contract or explicitly version a replacement. A mismatching revision rejects an obsolete board. Other `-for` verbs are denied. Feedback messages have custom type `learn-feedback`, `display:true`, and `triggerTurn:false`; showing feedback must not accidentally launch another model turn.

Sources: [tool registration](../agent/extensions/learn.ts#L135), [commands](../agent/extensions/learn.ts#L247), [revision hash](../agent/neura/learn-renderer.ts#L15).

### Learn lesson and exercise schema

The provider-facing schema rejects additional properties on lesson/diagram/exercise/table objects. All textual bounds below count characters unless explicitly stated as bytes. Runtime validators additionally reject disallowed control characters, invalid graph relationships, and unsafe SQL fixtures.

| Field | Provider-facing contract |
| --- | --- |
| `id`, `title`, `goal` | Slug id 2–80; title 1–160; goal 1–500 |
| `steps`, `currentStep` | 1–5 labels, each 1–120; zero-based currentStep 0–4 and less than actual step count |
| `bullets`, `example` | 3–5 bullets, each 1–300; worked example 1–2000 |
| `diagram` | Kind `flow\|er\|sequence`; title 1–160; 2–6 nodes; 1–12 edges; optional focus |
| Diagram node | ID matches `^[a-z][a-z0-9-]{0,39}$`; label 1–50; optional detail 1–240; optional 1–6 fields each 1–60 |
| Diagram edge/focus | `from` and `to` 1–40, label 1–80; unique node IDs, both endpoints exist and differ, focus names an existing node |
| `references` | 0–12 `{sourceId,filename,unit,number,excerpt}`; hash-shaped sourceId, filename 1–240, unit `page\|slide`, number 1–100, excerpt 1–2000 |
| Common exercise fields | Prompt 1–1000; 1–5 hints each 1–500; explanation 1–2000 |
| Choice exercise | `kind:"choice"`, 2–6 option strings of 1–500, zero-based answer index 0–5 and within options |
| Short exercise | `kind:"short"`, 0–10 acceptedAnswers of 1–500; an empty list means subjective, not automatically wrong |
| SQL exercise | `kind:"sql"`, solution 1–4000; 1–6 tables; optional 0–100 expectedRows |
| SQL table | Name at most 40; 1–12 columns with name at most 40 and type `TEXT\|INTEGER\|REAL`; 0–100 rows, each matching column count |
| SQL values | Null, finite numbers within `Number.MAX_SAFE_INTEGER` magnitude, or strings at most 1000; result/expected rows are column-name-to-value records |

SQL table and column identifiers must start with a letter and contain only letters/digits/underscore; table names are case-insensitively unique and cannot start with `sqlite_`; columns are case-insensitively unique. Standalone fixture validation adds an aggregate 2400-cell and 200,000-character serialized table limit. Runtime diagram references and source hashes must validate even if provider-side schema validation already passed.

Important existing discrepancies: standalone `assertLearnLesson` allows a one-character id, a 3000-character example, reference numbers up to 10,000, and a larger character-count document bound, while the registered tool uses the stricter bounds above plus 128 KiB UTF-8. Standalone exercise validation allows a 1200-character prompt, 8000-character solution, eight tables, 200 fixture rows, and 200 expected rows; the public tool is stricter. The HTML textarea and standalone evaluator allow 8000-character answers while the extension command/tool path permits 4000. These differences are not permission to expand the migrated public interface inadvertently; keep the strict public contract and explicitly decide any later cleanup.

Sources: [provider schema](../agent/neura/learn-schema.ts#L8), [lesson validator](../agent/neura/learn-renderer.ts#L20), [exercise validator](../agent/neura/learn-exercises.ts#L25).

### Source imports, offline OCR, and exact citations

An import is a bounded workspace-local byte capture followed by child-process parsing, not a remote document service. Inputs are limited to 25 MiB, 100 pages/slides, 16 MiB serialized worker output, and 120 seconds. Reject URLs, UNC/device paths, alternate-stream colons, control characters, empty/oversized paths, workspace escapes, hidden path components, `node_modules`, `sessions`, and `approvals`. Reject symlinks/junction traversal, nonregular files, multiple hard links, empty files, and unsupported formats. `.ppt` specifically asks the user to export `.pptx` or PDF. Resolve the workspace and source canonically, require a strict descendant, walk path components, open the source, compare opened device/inode/size/link count, read at most expected size plus one, and recheck count/size/mtime/canonical path. Send captured bytes to the worker; never ask it to reopen a caller-supplied path.

Material identity is `sha256:<64 hex>` of the captured bytes. A material is `{id,name,kind:"pdf"|"pptx",pages,warnings}`; each page is `{number,text,notes?,images?,extraction:"text"|"ocr"|"empty"}`; each image is `{mimeType:"image/png",data:<base64>,description}`. The worker has a 384 MiB V8 heap cap, ignored stdio plus IPC, `windowsHide:true`, and an environment restricted to `SystemRoot`, `WINDIR`, `TEMP`, `TMP`, and `DISABLE_SYSTEM_FONTS_LOAD=1`. Abort and deadline paths kill the worker and remove listeners. This is resource/process separation, not a general native parser sandbox guarantee.

Text is limited to 100,000 characters per page text/notes and 1,000,000 total. Images are retained only up to 1 MiB each and 8 MiB total; omitted previews create warnings without silently renumbering pages or discarding extracted text. Defaults enable both previews and OCR.

PDF handling verifies `%PDF-`, uses the pinned local PDF.js legacy package and local font/cmap/wasm assets, disables system fonts/font faces/worker fetch, limits image pixels to 16 million, and stops on parser errors. Password-protected PDFs require an unlocked export. Text items preserve line endings. Preview rendering scales to at most 1400 pixels on the longest side and at most 2×. Textless pages can use OCR; failed raster/OCR work leaves warnings and any available text. `isEvalSupported:false` is present in options, but the checked dependency documentation explicitly says the installed PDF.js versions do not consume that flag; it must not be cited as a security control.

OCR uses bundled `@tesseract.js-data/eng`, local `langPath`, gzip data, no cache, and no runtime model download. Missing local model data returns a warning and available preview/text rather than contacting a CDN. OCR is English-only and can misread content. PPTX image OCR can supplement existing slide text, labelled `[Embedded image OCR]`.

PPTX ZIP parsing stays in memory: at most 3000 entries, 64 MiB aggregate declared expansion, and 16 MiB per entry. Validate actual sizes and CRC32. Reject duplicate names, encrypted entries, symlink entries, absolute/backslash/colon/control/traversal names. XML is limited to 4 MiB per part, rejects DTD/entity declarations, bounds nodes to 100,000 and depth around 80, and uses namespace-aware `saxes`. Require content types and presentation parts. Slide order comes from presentation relationships, not lexical filenames. Internal relationship resolution rejects URL/UNC/traversal/percent/hash/missing-part targets; external relationships are ignored with warnings and never fetched. Notes are read through their relationship. Ignore macros, ActiveX, and embeddings with warnings. Decode at most eight PNG/JPEG images per slide, validate dimensions before and after decode, bound pixels to 16 million, and shrink to at most 1400 pixels. Complex layout, charts, SmartArt, equations, animation, and masters are not reproduced; export PDF for visual fidelity.

Citation validation checks source hash, original filename, matching page/slide unit, integer page number, and a nonempty bounded excerpt that appears after whitespace normalization within that same page's text or notes. It does not prove that an excerpt supports a model's interpretation. New lessons may cite only material reimported/verified during the current session. No references means a clearly labelled tutor-created lesson, not fabricated source grounding.

Sources: [import boundary](../agent/neura/learn-materials.ts#L36), [citation matching](../agent/neura/learn-materials.ts#L143), [worker limits and parsers](../agent/neura/learn-materials-worker.mjs#L9).

Pinned Learn runtime dependencies currently are `@napi-rs/canvas@1.0.11`, `@tesseract.js-data/eng@1.0.0`, `pdfjs-dist@6.4.299`, `saxes@6.0.0`, `tesseract.js@7.0.0`, and `yauzl@3.4.0`, in the private Apache-2.0 `neura-learning-runtime` package. These are separate from the agent framework; Mastra does not replace their parsing/OCR responsibilities. Keep exact pins, source review, lockfiles, native-platform checks, and offline model behavior. [Dependency manifest](../agent/neura/package.json#L1).

### Exercise execution and grading

Choice grading accepts user-visible one-based option numbers or normalized option text; authoring indexes remain zero-based. Short-answer matching trims, collapses whitespace, and lowercases. An empty accepted-answer list yields `correct:null` for tutor review. A mismatch is not proof the learner's reasoning is wrong. Results are `{correct:boolean|null,feedback,rows?,truncated?}`.

SQL uses a fresh disposable Node child with a fixed embedded program, `shell:false`, a 64 MiB V8 heap cap, and only `SystemRoot` on Windows in its environment. Learner SQL reaches stdin as JSON, never JavaScript or shell text. SQLite is in-memory, extensions disabled, double-quoted string literals disabled, memory temp/journal storage, native hard heap limit 33,554,432 bytes. Populate bounded fixtures first; then enable query-only mode and install `DatabaseSync.setAuthorizer` (Node 24.15 or later). Allow SELECT, READ of declared fixture tables in main, and only these functions: `count,sum,avg,min,max,total,round,abs,lower,upper,length,coalesce,ifnull,nullif,substr,substring,trim,ltrim,rtrim,typeof`. Deny everything else, including attach, pragma access, writes, recursive CTE authorization, filesystem functions, extension loading, and undeclared SQLite catalog reads.

Input must begin SELECT or WITH, allow one optional trailing semicolon, and reject any remaining semicolon or NUL. Leading comments are intentionally unsupported. Child stdin is capped at 240,000 characters; parent stdout at 220,000; results at 12 uniquely named columns, 200 rows, 1000-character string cells, finite safe numbers/null, and 200,000 serialized characters. A three-second deadline kills the child. Truncated output is shown but ungraded. With expectedRows, compare column names, values, and duplicates while ignoring row order. Without an answer key, return `correct:null`. Failures return `correct:false` with bounded lab feedback; each later exercise gets a new clean database/process.

The evaluator itself does not accept an AbortSignal. Extension generation/cancellation checks discard stale completion, but that is not proof of immediate SQL worker termination on user cancellation; timeout still bounds it. A migration can improve this only with explicit tests rather than claiming current parity already covers immediate cancellation.

Source: [SQL worker, execution, and comparison](../agent/neura/learn-exercises.ts#L68).

### Local boards and explicit snapshots

Workspace storage is `.neura-learning/`, owned by an `owner` file containing `neura-learning-v1\n` and a `.gitignore` containing `*\n`. Never adopt an existing unowned directory, empty or otherwise. First-time store creation is currently Windows-only: construct a sibling `.neura-learning-init-<UUID>` directory with complete markers, then use Windows' nonoverwriting directory rename behavior. A concurrently created valid owned destination may be reused. Interrupted staging is not recursively auto-deleted. Existing valid owned stores can be read/reused independently of that first-create restriction.

Real-directory checks reject direct and ancestor links/junctions and compare canonical paths case-insensitively on Windows. Exclusive file creation uses `wx`, mode 0600, validated single-component filenames, bounded bytes, parent/path/open-handle identity and single-link checks before content, handle-based writes, sync, and post-write identity checks. Regular reads use lstat, bounded size, `O_NOFOLLOW` where available, open-handle identity, and a limit-plus-one read. These checks reduce race exposure but do not promise an OS security boundary against another process running as the same user.

Artifacts are `lesson-<UUID>.html` up to 2 MiB; explicit snapshots are `progress-<UUID>.json` up to 8 MiB. Writes are exclusive; no overwrite-based progress autosave. Listing scans bounded filename candidates, rejects more than 10,000, sorts mtime descending with filename tie-break, and returns newest 100. Resume accepts only a basename matching the progress-file shape and reads within the owned root.

Snapshot version 1 contains lesson, attempts, notes, nextStep, hint, revealed, assisted, and material text/metadata with all image bytes removed. Restore permits at most 12 materials, 100 attempts, and 30 notes. Material IDs must be SHA-256 IDs, distinct; names nonempty up to 255; kind PDF/PPTX; 1–100 uniquely numbered pages in 1–100; text/notes at most 100,000 each; no image field; extraction one of the three enum values; warnings at most 512, each at most 1000. Lesson validation includes the 128 KiB serialized bound and citations against saved text. Attempts require a bounded slug, answer up to 4000, feedback up to 8000, exact booleans/nullable boolean, and a valid millisecond ISO timestamp. Notes/nextStep are at most 1000; hint is a nonnegative integer. Restored `verifiedSources` remains empty even when snapshot citation checks pass. Resume renders a historical board and preserves historical attempt evidence without converting it into trusted mastery or new source verification.

Sources: [file primitives](../agent/neura/learn-files.ts#L10), [store initialization and naming](../agent/neura/learn-store.ts#L12), [snapshot and restoration](../agent/extensions/learn.ts#L53).

### Learn board UI

The browser board is standalone local HTML, not a hosted app and not a direct connection to Neura. It has Understand/Practice/References navigation, a practical goal, step progress, 3–5 explanation bullets, worked-example details, a diagram, hints, answer reveal, references, and explicit commands to hand work back to the terminal. “Let me try” focuses the answer control. “Show example” opens the example. Explain differently/go deeper/example actions prepare revision-bound terminal commands. Copy attempts clipboard access and falls back to selected command text; there is no hidden browser-to-agent bridge. Browser activity does not automatically persist or synchronize. Reopening a board resets its local hint/reveal state.

The diagram supports flow, ER, and sequence representations with accessible title/description, full-text alternatives, a keyboard-focusable scroll region, focus buttons with `aria-pressed`, and live details. ER shows fields; sequence shows numbered arrows/lifelines. Focus highlights the chosen node and related edges. Nodes use bounded wrapping, spacing of 220 pixels, and a minimum SVG width of 640 inside its scroll container.

Choice and short-answer checks run locally using the same basic grading conventions; subjective short answers explicitly remain ungraded. SQL never executes in the browser: it prepares a terminal handoff. Hints and reveal produce helped-answer commands, and reveal explicitly avoids claiming learning. The answer is present in the HTML source by design; this is self-study software, not an exam security system.

The shared dark palette, 1280-pixel content width, desktop main/sidebar layout with 300-pixel sidebar, <=850-pixel single-column layout with sidebar first, >=44-pixel controls, 3-pixel focus outline, and reduced-motion behavior are part of the user experience. Historical boards prominently label saved evidence; references show source identity and excerpts. Source preview images are model/tool content, not automatically embedded into the board.

All generated text is escaped; embedded JSON escapes `<`, `>`, and `&`; fixed renderer JavaScript uses `textContent`. CSP permits only hashes of the fixed script/style and denies default/image/connect/font/base/form/object resources. No remote scripts, fonts, tracking, or browser SQL. Preserve CSP hash recalculation when editing renderer code.

Source: [Learn renderer and fixed browser program](../agent/neura/learn-renderer.ts#L62).

### Optional Obsidian vault and bounded learner preferences

Vault continuity is opt-in. `NEURA_LEARN_VAULT` takes precedence over the machine-local `~/.pi/agent/neura/learn-vault.json`, whose exact schema is `{version:1,vault:string}` with no other keys and a 4096-byte limit. The chosen vault must be an absolute local non-UNC real directory containing a real `.obsidian` child. Linked/relative/unowned paths fail closed. Mapped network volumes cannot be reliably identified by this check and remain unsupported. A Mastra migration must explicitly relocate or support the legacy configuration path; it must not silently lose a user's opted-in vault.

Only `Neura/` inside the vault is managed, marked by `.neura-owner` containing `neura-learn-vault-v1\n`. Reject an existing unowned Neura subtree. Never modify `.obsidian`, original source documents, unrelated notes, or user-edited projections. Managed event history is under `Neura/_System/events/`, with append-only slots `0000.json` through `1999.json`. Each event file is at most 32 KiB. Require strict contiguous slots and valid envelope/schema/digest; corruption, gaps, or capacity exhaustion fail closed. Each envelope is `{version:1,digest:SHA256(JSON.stringify(event)),event}`; event adds `version:1`, UUID `id`, and ISO `at` to the input. Hashes detect accidental corruption, not authenticated tamper resistance against the same user.

Base event fields are `lessonId` (safe slug, <=80), `title` (<=160), optional `topic` (<=120), and optional 64-hex `lessonRevision`. Credential-shaped identifiers are rejected. Event variants are:

- Concept: `type:"concept"`, goal <=500, 1–5 bullets <=1000, example <=4000, nextStep <=1000.
- Practice: `type:"practice"`, correct boolean/null, assisted/revealed booleans, exerciseKind <=20. Raw learner answers are deliberately omitted.
- Finding: `type:"finding"`, optional finding/nextStep <=1000 with at least one present.
- Preference: `type:"preference"`, recognized key/value and 64-hex evidenceDigest; raw evidence messages are omitted.

Append retries transient concurrent-owner/partial-slot situations for up to five seconds with 10-ms polls, claims the next slot using exclusive creation, retries an EEXIST race, and reconciles missing Markdown projections from durable events. There is no mutable lock file. Projections are `Topics/<slug>/YYYY-MM-DD-UUID.md` for concepts, `Learner/Mistakes/<slug>/...` for practice/findings, and `Learner/Preferences/...` for preferences. An existing projection is not overwritten, preserving human edits. Text is control-cleaned, truncated, pattern-redacted, and Markdown-escaped; example fences dynamically exceed embedded backtick runs. These remain plaintext files with limited redaction, not a secret-storage system.

Recognized preferences are explanation `short|balanced|detailed`; exampleTiming `first|after-theory`; diagrams `prefer|when-useful|minimal`; hintStyle `progressive|direct|question-led`; pace `slower|balanced|faster`. Evidence hashes use NFKC plus collapsed/trimmed whitespace. A preference activates only after at least two distinct evidence digests for the same value; the value with most distinct evidence wins, with insertion order resolving a tie. Difficulty counters increment for incorrect, assisted, or revealed practice; only the top eight by count are retrieved. The prompt receives enums/counters as untrusted hints, not arbitrary vault Markdown or instructions. No mastery score is synthesized.

Vault write/read errors warn and allow learning to continue; there is no rollback of a successful board because automatic vault export failed. Explicit snapshots remain the recovery path. An existing mismatch deserves attention: the extension passes lesson title as topic, but a lesson title may be 160 characters while vault topic allows only 120, so a long valid title can make automatic capture warn/fail without preventing the lesson. Do not conceal that limitation in parity claims.

Sources: [vault configuration/ownership](../agent/neura/learn-vault.ts#L78), [event validation](../agent/neura/learn-vault.ts#L165), [append/retrieval](../agent/neura/learn-vault.ts#L234).

## Learn and Plan migration ownership and acceptance

The parsers, OCR worker, citation validation, exercise evaluator, filesystem primitives, snapshot store, vault journal/projections, and HTML renderers are Neura-owned modules that can largely survive the framework change. They are not native Mastra features and must not disappear behind a generic memory/workspace abstraction. TypeBox schemas can be adapted while retaining effective constraints. The Pi-coupled work is in extension registration, provider tool results (especially `terminate:true`), custom messages/status, input-source provenance, mode events, abort/generation lifecycle, session journal/replay, follow-up scheduling, and Plan's per-file mutation queue. Mastra storage must explicitly implement these contracts; choosing Mastra does not establish them automatically.

Before declaring feature parity, demonstrate all of the following against the replacement runtime:

- Plan tool gating remains enforced at execution time; approval text cannot turn Plan into source-writing mode. Structured documents cannot inject executable HTML. Backend plans can omit preview; product plans retain reviewable preview guidance.
- Plan waiting survives replay without false missing-artifact failure; a completed artifact-less turn retries exactly once; errors/aborts do not retry; terminal failure is recorded once in TUI and headless/JSON/RPC paths. Explicit new requests reset state; arbitrary follow-up messages do not.
- New Plan collisions preserve human files; revisions preserve path and reject external edits, changed slug/project, links, and oversized content. Publication reports journaling failure honestly. Crash tests cover disk-write/event-write gaps and replay on the active branch.
- Learn exposes exactly its approved tool set. Material/progress calls can continue a turn; lesson/exercise calls stop at learner-facing boundaries. Model-generated answers/preferences cannot impersonate actual interactive user input, and evidence is consumed once.
- Generation checks discard late import/evaluation/save/resume completion after mode/session/reset changes. Test real cancellation and separately document SQL worker timing. Session/tree changes clear state; explicit resume restores a historical, untrusted-source lesson.
- Positive imports cover text PDFs, scanned PDFs, PPTX relationship order, speaker notes, and embedded image OCR offline. Negative imports cover URL/UNC/ADS/traversal/hidden/session/link/hardlink inputs, unsupported/empty/oversized/malformed documents, >100 pages, ZIP expansion/CRC/path errors, XML entities/depth, oversized images, missing offline OCR data, and pre/in-flight cancellation.
- Citation checks reject wrong hash/name/unit/page/edited excerpt, require current-session reimport after resume, and preserve identical-byte filename identity. Restored sources never become trusted merely because snapshot JSON is well-formed.
- Exercise tests cover choice numbering/text, normalized short answers, ungraded subjective responses, SQL duplicate rows/column labels/null/numeric bounds, missing key/truncation behavior, and denial of attach/writes/pragma/catalog/filesystem/extension/multiple statements/recursive resource attacks. Deadline failure must not poison the next exercise.
- Learn store tests cover Windows concurrent first creation, interruption, unowned destination races, linked ancestors, pre/post-open swaps, hardlinks, capacity/list ordering, corrupted snapshots, and non-Windows first-create refusal. Preserve bounded nonoverwriting writes and do not adopt arbitrary user folders.
- Vault tests cover disabled/default configuration, valid opt-in, malformed/oversized/relative/UNC/linked/unowned paths, concurrent creation/appends, contiguous-slot integrity, corruption/gaps/capacity, projection recovery and user edits, redaction, no raw answers/messages, two-distinct-evidence activation, and bounded profile retrieval.
- Browser tests exercise keyboard operation, visible focus, diagrams, hints/reveal/helped handoff, stale revisions, clipboard fallback, subjective and SQL behavior, historical notices, no horizontal page overflow, and accessibility at mobile/desktop widths. Inspect real rendered screenshots, not only HTML strings.

Existing automated evidence is available in [Plan integration tests](../scripts/tests/plan.mjs#L1), [Learn integration suite](../scripts/verify-learn.mjs#L1), [material parser suite](../scripts/verify-learn-materials.mjs#L1), [exercise/renderer suite](../scripts/verify-learn-workshop.mjs#L1), [storage race suite](../scripts/verify-learn-storage.mjs#L1), [vault suite](../scripts/verify-learn-vault.mjs#L1), [Learn browser suite](../scripts/verify-learn-browser.mjs#L1), and [Plan accessibility suite](../scripts/verify-plan-accessibility.mjs#L1). Learn's browser suite uses Edge at widths 390 and 1280, offline mode, reduced motion, CSP still enabled, zero non-file requests/page errors, and axe WCAG 2/2.1/2.2 A/AA tags. Plan uses 375×812 and 1280×900, offline/reduced-motion, navigation-section equality, >=44-pixel targets, >=3-pixel focus, and axe; its test context sets `bypassCSP:true` to inject axe, so it is not itself proof that the shipped Plan CSP resists injected scripts.

This audit read the complete implementation files `agent/extensions/learn.ts`, `agent/extensions/plan-artifact.ts`, and `agent/neura/{learn-schema,learn-policy,learn-materials,learn-files,learn-store,learn-vault,learn-renderer,learn-exercises,plan-policy,plan-renderer}.ts`, plus `learn-materials-worker.mjs` and the Learn package manifest. It read the complete material/workshop/storage verifier implementations and inspected integration/browser/vault/Plan test assertions and relevant fixtures/wrappers. `docs/LEARN_MODE.md` and dependency documentation supplied intent, but source controls contradictions: for example, the Learn documentation's blanket statement that skill reports are YOLO-only is stale relative to the current skill-doctor behavior. Historical plans are not current requirements. This section records source-inspected behavior; no parser benchmarks, migration prototype, new browser run, or runtime migration validation was performed for this documentation audit.

## Installation, distribution, dependencies, and launch contract

This section describes inspected checkout behavior, not a fresh installation or external package audit. The candidate is `2.6.0-rc.1`, the latest published version recorded in status is `2.5.1`, and the supported scope remains experimental personal, single-user engineering use. Human Away remains preview-only. A Mastra migration must preserve those labels until the production gates are independently met. Source: `docs/STATUS.md`, `docs/PRODUCTION_READINESS.md`.

### Runtime and dependency boundaries

Neura is an ESM TypeScript/Node application distributed as repository-owned extensions and modules, with a Windows PowerShell installer and command launcher. The root package is private, Apache-2.0, and requires Node `>=24.15.0`; CI uses `24.16.0`. Root `package-lock.json` records the development/runtime-loader graph. `agent/neura/package-lock.json` records a separate Learn document-processing graph. The nested package's independent version is `1.0.0`; it is not the Neura release version. Both graphs use exact direct versions and consumer installation scripts are disabled. Source: `package.json`, `agent/neura/package.json`, `tsconfig.json`, `docs/DEPENDENCIES.md`.

| Surface | Exact checkout pin | Current responsibility and migration obligation |
|---|---|---|
| `@earendil-works/pi-coding-agent` | `1.3.0` | Provider execution, base tools, extensions, session lifecycle, discovery, interactive commands, child processes. Replace these interfaces explicitly. |
| `@earendil-works/pi-ai` | `1.3.0` | Provider/model types and execution APIs. Preserve provider and authentication behavior; API-key access is not subscription parity. |
| `@earendil-works/pi-tui` | `1.3.0` | Terminal components, editor, layout/width behavior and keyboard integration. Complete Pi removal includes replacing this library. |
| `@spences10/pi-mcp` | `0.0.58` | Root development dependency and installed runtime package; Neura owns its lifecycle wrapper. Native package extension discovery is disabled. |
| `@ollama/pi-web-search` | `0.0.5` | Search/fetch calls to local Ollama at `127.0.0.1:11434`; Ollama performs external access. Direct fetch is denied in Plan. |
| `@spences10/pi-redact` | `0.0.14` | Pattern-based local redaction of tool results before model context. Preserve interception ordering and negative tests. |
| `@spences10/pi-lsp` | `0.0.44` | Language servers and project reads after project-trust checks. A replacement must retain trust and process restrictions. |
| `pi-subagents` | `0.41.0` | Isolated Pi child processes and delegation state. Human Away does not expose its tool. Rebuild child lifecycle and policy inheritance. |
| `@spences10/pi-context` | `0.1.15` | Local SQLite context sidecar under the live harness. Preserve context semantics and private storage migration deliberately. |
| Development tools | `@types/node 26.6.5`, `axe-core 4.14.0`, `playwright-core 1.64.0`, `typebox 1.3.36`, `typescript 7.0.2` | Compiler, schemas and browser accessibility validation. Playwright Core uses an existing browser, not an automatically downloaded browser. |
| Learn document runtime | `@napi-rs/canvas 1.0.11`, `@tesseract.js-data/eng 1.0.0`, `pdfjs-dist 6.4.299`, `saxes 6.0.0`, `tesseract.js 7.0.0`, `yauzl 3.4.0` | Reusable parser/OCR dependencies, with their separate lock, native/WASM trust and bounds. Keep installation and integrity ownership. |

The listed external package roles are documented integration obligations. Their installed source was not available for a complete fresh source audit in this session. No claim is made that the reference fully specifies every upstream Pi feature. The exact repository contracts and tests, and a later explicit upstream feature inventory, must govern replacement. Existing Pi/dependency reviews are historical evidence dated in `docs/DEPENDENCIES.md`, not evidence that Mastra already provides equivalence.

`tsconfig.json` targets ES2024 with NodeNext modules/resolution, JSON modules, Node types, `allowImportingTsExtensions`, `noEmit`, and `skipLibCheck`. Both `strict` and `noImplicitAny` are false. The include set is `agent/**/*.ts`; strict typing is an existing hardening gap, not an established property to claim during migration.

`agent/neura/runtime-contract.json` schema 1 is executable identity policy. It pins the Pi version, Windows Git, and contained proof runtime. Windows automatic Git requires `git version 2.50.1.windows.1` and executable SHA-256 `c954fcc8e65a38450895ca65d308ecaee63f044d16494b5385faa5e036a3facb`. CI uses the contract's official portable archive URL and SHA-256 `c45a7dfa2bde34059f6dbd85f49a95d73d5aea29305f51b79595e56e4f323a3d` before extracting it. Production resolution accepts `NEURA_GIT_EXECUTABLE` or the fixed Program Files Git locations, rejects workspace-contained executables, then checks hash and exact version. It does not search arbitrary PATH for automatic Git. `process-security.ts` additionally strips inherited process environment to an explicit allowlist and disables Git hooks, global/system config, credentials, prompts, lazy fetch and optional locks for automatic operations. An explicitly absolute executable has separate path validation; do not conflate that path with named-Git identity verification. Source: `agent/neura/process-security.ts:35`, `agent/neura/process-security.ts:71`, `agent/neura/process-security.ts:94`.

Proof requires uv `0.12.11`, CPython `3.12.3` at `/usr/bin/python3.12`, the exact Ubuntu package identity `python3.12-minimal 3.12.3-1ubuntu0.13 amd64`, and the contract's executable/artifact hashes. Its exact offline wheel closure is `proof-of-work-agent 0.2.0`, `cryptography 49.0.0`, `cffi 2.1.0`, `pycparser 3.0`, `PyYAML 6.0.3`. Missing/wrong components make proof unavailable; they never trigger download or host fallback. The runtime contract carries hashes rather than using version strings alone. The independent package signature limitations are documented in `docs/DEPENDENCIES.md:38`; migrating frameworks must not turn these into stronger provenance claims.

### Defaults and launch

The checked-in `agent/settings.json` defaults to provider `openai-codex`, model `gpt-5.5`, theme `dark`, `quietStartup: true`, and `lastChangelogVersion: 0.81.1`. These are source defaults, not an observation of the user's private profile. The Neura extension supplies its own runtime presentation. Supported built-in skills are excluded from generic discovery with `skills: ["!skills/**"]`; validated opt-in discovery adds the approved files later. Runtime packages are exactly those in the table. The MCP entry is the object `{ "source": "npm:@spences10/pi-mcp@0.0.58", "extensions": [] }`, not an ordinary package string, so the third-party extension cannot create a second MCP lifecycle.

`agent/keybindings.json` sets thinking to `ctrl+shift+t`, submit to `ctrl+enter`, and newline to `enter`, `shift+enter`, or `ctrl+j`. Moving thinking frees Shift+Tab for Neura modes. A replacement input editor must preserve these deliberate multi-line semantics and mode shortcut ownership.

`launcher/neura.cmd` sets the terminal title to `neura`, chooses `%USERPROFILE%\.pi\agent` unless `PI_CODING_AGENT_DIR` overrides it, runs the managed runtime integrity check through Node, and fails before launch if that check fails. It sets `NEURA=1`, requires `pi` to resolve, and launches `pi --no-mcp --tui-mode regular %*`. `--no-mcp` prevents native Pi MCP startup even when config or builtin selection would otherwise enable it; Neura's explicit YOLO wrapper owns connections. `--tui-mode regular` is part of the supported presentation contract. Plain `pi` remains stock because Neura-specific extensions are gated on `NEURA`. A Mastra launcher must give equally explicit ownership to MCP, policy and Neura activation instead of inheriting unrestricted auto-discovery.

The installer creates a Windows Terminal profile with GUID `{7e8b22c4-2cd7-5f7c-b5a8-a461f718bdaf}` at `%LOCALAPPDATA%\Microsoft\Windows Terminal\Fragments\Neura\Neura.json`. It runs `cmd.exe /d /s /c` with the quoted launcher, begins in `%USERPROFILE%`, uses background `#0b0c0e`, foreground `#e8e2d8`, the managed launch artwork centered at opacity `0.42` with uniform stretch, terminal opacity 100, padding 12, acrylic disabled, and `PI_SKIP_VERSION_CHECK=1`. A Start Menu shortcut `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Neura.lnk` opens `wt -w new -p Neura` with home as working directory. Missing `wt` means no Terminal integration; launcher use still remains. Preserve the logo-only startup and managed artwork described by the UI contract. Source: `install.ps1:135`, `launcher/neura.cmd`.

The checked-in global MCP template defines disabled Paper at loopback port 29979, enabled Context7 at `https://mcp.context7.com/mcp`, and disabled Gmail with a placeholder Composio streamable-HTTP endpoint and `${COMPOSIO_API_KEY}` header reference. These are templates, not private endpoints or credentials. Configuration must never copy a real credential into the repository. Source: `agent/mcp.json`.

### Installer lifecycle and ownership

`install.ps1` accepts `-Check` and `-ForceSettings`. The managed target defaults to `~/.pi/agent`; `PI_CODING_AGENT_DIR` changes that target. The launcher remains `~/.local/bin/neura.cmd`, and installation lock/transaction/extension-allowlist locations remain under `~/.pi`, even when the agent target is overridden. That split matters to profile migration.

Prerequisites are checked before staging in Node-first order. `Get-Command` must find an Application or ExternalScript; version probes capture native exit status, suppress incidental stderr and restore the caller's native exit state. Node accepts a `v` prefix, Git accepts its normal prefix and Windows suffix, but the normalized result must be one stable `x.y.z` line. Missing/failing/malformed/multiline/prerelease probes fail. Node must meet the manifest minimum; Pi must equal the runtime contract. A newer Pi is reported as a Neura compatibility defect: update Neura, never offer to downgrade Pi. npm and Git must have parseable versions; that prerequisite check is separate from the automatic Git binary hash gate. Source: `install.ps1:27`, `install.ps1:51`, `install.ps1:68`.

Before acquiring the transaction, install validates existing private settings and keybindings as JSON. It acquires an exclusive `~/.pi/neura-install.lock` with `FileShare.None` over recovery, staging, activation and configuration. It recovers an existing pending managed transaction, then follows this exact sequence:

1. `runtime-install.mjs prepare` validates source manifest, skill package, ownership and every managed source hash, then creates a staging tree.
2. `npm.cmd ci --prefix <staging>/agent/neura --ignore-scripts --no-audit --no-fund` installs the separate Learn graph in staging.
3. The installer writes `.learn-runtime-lock` containing the uppercase SHA-256 of the nested lockfile.
4. `seal` creates an install receipt that includes the staged Learn modules.
5. `activate` validates again, backs up owned targets, journals the exact operation list, replaces managed files, removes only proven stale owned files and verifies the result.
6. Any managed activation failure invokes recovery. A failed recovery fails the install rather than silently proceeding.
7. After managed activation, the script writes Terminal resources and merges keybindings/settings. The settings merge preserves the user's provider, model, theme and unrelated packages. It adds required skill exclusions and replaces matching npm package identities with exactly one reviewed specification. `-ForceSettings`, or no existing settings file, copies the source settings instead.

The npm identity merge strips package versions for identity comparison, including scoped packages; the specification comparison still requires the complete intended string/object. Keybinding merge replaces only required keys and retains unrelated bindings. The installer never stages credentials, sessions, approvals or memory. It does not bootstrap Node, npm, Pi, WSL or all Pi-managed extensions, and does not edit PATH. Successful output still instructs the user to run `pi update --extensions --approve`, then `neura` and `/health`. Optional proof prerequisites may warn without failing install. Source: `install.ps1`, `agent/neura/runtime-install.mjs:249`.

The release manifest at `agent/neura/release-manifest.json` is schema 1 with Neura version, exact stable Pi version, minimum Node version and per-file SHA-256. It includes managed extension/theme/module files, the versioned supported skill, `agent/mcp.json` and `launcher/neura.cmd`. The manifest does not hash itself or the generated install receipt. `agent/settings.json` and `agent/keybindings.json` are handled by the later merge, not by that managed file transaction. The docs checker checks complete coverage of the managed source surface, including all 19 extensions. Unknown files must not become managed implicitly.

The runtime transaction allows only restricted managed path shapes below extensions, themes and Neura modules plus MCP and launcher. It rejects traversal and existing symbolic-link/junction ancestors. Neura versions may be valid stable/prerelease SemVer without numeric leading zeros; Pi/Node values must be stable numeric triples; hashes must be 64 lower-case hexadecimal characters. Existing managed targets must match either new expected bytes or a valid previous ownership receipt. An unreceipted nested `node_modules` tree is rejected, not recursively adopted/deleted. Unknown extension files require explicit `~/.pi/neura-user-extensions.json` schema 1 allowlisting of extension filename to SHA-256. The allowlist accepts only expected regular extension file types. Retired `agent/extensions/autogit.ts` is removed only when ownership is proven. A skill version is immutable: changing bytes in the same version path is rejected. Source: `agent/neura/runtime-install.mjs:21`, `agent/neura/runtime-install.mjs:81`.

The generated `.install-state.json` binds schema, source commit (40 hex or `unavailable`), manifest hash, Neura version, installation time, and exact files including every Learn `node_modules` file and lock receipt. Recursive inventory rejects links and special files. Full verification checks exact digests and unknown nested module files. The launcher's check uses full verification. `/health` uses the bounded `--quick` check: it retains receipt identity, source-file, skill and ownership checks but skips hashing and inventorying every nested module. `check --source` also compares the installed manifest to the checkout. Do not describe a quick health result as a full installed dependency scan. Source: `agent/neura/runtime-install.mjs:132`, `agent/neura/runtime-install.mjs:142`.

Activation uses exclusive temporary files followed by rename for each managed target. It validates staged and existing state before writes, records indexed backups or zero-byte absent markers and the exact ordered journal, then verifies live state before marking the transaction complete. Recovery validates the whole staged receipt and expected journal before mutations, requires each entry to have exactly the valid backup/absent state, and removes a newly installed file only when the expected staged bytes prove ownership. Restores also use exclusive temporary files and rename. Interrupted restore can be retried. A narrowly scoped pre-skill legacy recovery path applies only when neither manifest, receipt nor physical installation claims a skill registry. Source: `agent/neura/runtime-install.mjs:196`, `agent/neura/runtime-install.mjs:277`.

This is not complete install atomicity. Settings, keybindings and Terminal changes occur outside managed-file rollback; prerequisite bootstrap, extension package activation, future PATH changes and all cross-component recovery remain unfinished. Existing checks reject path links but do not establish race-free protection from a malicious same-user path swap or tampering with the transaction. A Mastra installer should extend the existing ownership/recovery engine rather than build an unrelated second one. Clean-host, interruption, upgrade and rollback rehearsals remain required. Source: `docs/INSTALLER_READINESS.md:31`, `docs/PRODUCTION_READINESS.md`.

`-Check` is read-only drift inspection. It repeats prerequisites, checks the runtime receipt and source agreement, compares source/live text with CRLF/trailing-newline normalization or binary hashes, looks for retired extension drift, verifies Learn lock/installed-lock/lock-receipt state, launcher/MCP files, required settings package/exclusion identities, keybindings, Terminal fragment and shortcut when applicable. If source Gmail is enabled, it checks key presence without printing it. Missing/drifted required state fails; optional proof warnings alone do not. A failing check is not authorization to install.

### Supported skills and discovery

Only the repository-owned `neura-verification` skill `1.0.3` is supported. Its manifest records exact file path `skills/neura-verification/1.0.3/SKILL.md`, content hash, repository provenance, owner `Rajveerx11`, update policy `reviewed-version-and-digest-change-with-smoke-tests`, compatibility `{pi:"1.3.0",profile:"read-only-guidance-v1"}`, no dependencies and `defaultEnabled:false`. It permits only authorized repository `read`; network, write and execute are false. These permissions restrict eligibility and never grant authority beyond active mode policy. Source: `agent/neura/skills-manifest.json`, `agent/neura/skills-registry.mjs:38`.

An optional `~/.pi/neura-skills.json` with exact shape `{ "schemaVersion": 1, "enabled": ["neura-verification"] }` opts in. Absence disables the skill. There is no command that automatically writes this enablement. Reload is required after an owner changes selection. This home-root path does not follow `PI_CODING_AGENT_DIR`.

The registry rejects unknown schema fields, duplicate case-insensitive names/canonical paths, unexpected owner/provenance/profile, unsupported versions, dependency declarations, links/junctions, special files, hash mismatches, or any unlisted file in the skill tree. Version directories may contain only `SKILL.md`; empty retired directories are tolerated because ownership is per file. Frontmatter must use the exact simple name/description format, with a single-line conservative description up to 1,024 characters. Content validation rejects non-read tool instructions, MCP names and unsupported agent tools, destructive commands, network/download/install commands and URLs, floating versions, Markdown resource links/images/reference definitions and script/iframe elements. Error output is generic and does not echo private paths or package contents. Source: `agent/neura/skills-registry.mjs:15`, `agent/neura/skills-registry.mjs:24`.

`skill-doctor.ts` is `NEURA` gated. Its resource-discovery hook appends only validated selected skill paths. It checks Pi's actual command registry for `source:"skill"`, reserved `skill:<name>`, exact `sourceInfo.path`, canonical path and digest; a competing winner, disabled reserved skill or mismatched discovered file is failure. Before discovery has completed, the one allow-missing phase permits absence, not identity mismatch. It cannot unload an externally discovered skill and never attests an unrelated winner. `/skill-doctor` is read-only in every mode and reports validation/digest/count state without host execution or permission upgrade. Health presents disabled/ready/unhealthy separately from core readiness. Source: `agent/extensions/skill-doctor.ts`, `agent/neura/skills-registry.mjs:105`.

Mastra must supply an explicit, testable resource registration and actual-winner identity mechanism. Replace the Pi compatibility field with a reviewed runtime compatibility identity, while preserving version/hash immutability, opt-in, command collision checks and the no-authority-grant rule. Unrestricted framework skill autodiscovery would lose the current boundary. Updates require a new version path and digest plus positive/negative real-loader smoke tests and managed manifest changes.

## Health and operational readiness contracts

`harness-health.ts` models capability states `missing`, `disabled`, `unhealthy`, `degraded`, `ready`; errors are classified as authentication, cancelled, configuration, response-limit, schema, startup or timeout. A capability has name, required flag, state, detail, action and optional classified problem. A report separates runtime identity, core workflow, context, workspace bridges, impact, remediation and capability list. A required unhealthy state makes the report unhealthy; otherwise any required non-ready capability yields degraded; all required capabilities ready yields ready. Optional gaps remain separately visible in impact/remediation without changing core readiness. Source: `agent/extensions/harness-health.ts:25`, `agent/extensions/harness-health.ts:603`.

The runtime identity combines the first 12 characters of a raw runtime-contract SHA-256 with a hashed source directory identity, labelled source or live. It must not expose absolute private paths. Required capabilities include Pi identity, Git workspace, modes, sandbox, proof, checkpoint and persona. Memory, supported skills, MCP and local Qwen are optional. The installed runtime check is a subprocess with a 5,000 ms bound and ignored stdio; its quick scope is described above. Remediation respects the newer-Pi no-downgrade rule. Source: `agent/extensions/harness-health.ts:132`, `agent/extensions/harness-health.ts:610`.

MCP health initialization has a default 2,500 ms timeout, independent stdout/stderr caps of 64 KiB, abort support and sanitized output. Names are bounded to 80 characters, details/actions to 220 and problems to 180. An HTTP probe sends JSON-RPC `initialize` id 1 and protocol `2025-11-25`; response protocols accepted are `2024-10-07`, `2024-11-05`, `2025-03-26`, `2025-06-18`, `2025-11-25`. It requires serverInfo name/version strings and an object capabilities field. It accepts bounded JSON or first valid SSE data payload. Unsafe HTTP is rejected except loopback; URL credentials/query and redirects are rejected. 401/403 become authentication errors, other unsuccessful statuses become startup failures. Header values must be exact uppercase environment placeholders allowed by `MY_PI_MCP_ENV_ALLOWLIST`; literal credential headers are not accepted. Source: `agent/extensions/harness-health.ts:249`, `agent/extensions/harness-health.ts:277`, `agent/extensions/harness-health.ts:303`.

The stdio probe accepts an absolute existing executable resolved outside the repository, string arguments, a scoped environment and `shell:false`; it handles newline JSON or Content-Length framing. It hides the Windows process window, enforces limits/timeouts and kills the child on completion/abort. It initializes a server, not general model tools. Global MCP configuration is merged with project `mcp.json` (preferred) or `.mcp.json`, with project entries overriding matching names. Every project-supplied name is untrusted for health probing even when it overrides a global name; these entries are reported rather than launched. `disabled:true` or `enabled:false` suppresses probes. Source: `agent/extensions/harness-health.ts:377`, `agent/extensions/harness-health.ts:461`, `agent/extensions/harness-health.ts:506`.

The local Qwen readiness check uses a 700 ms request to `http://127.0.0.1:8080/v1/models` and requires model ID `qwen3-coder-30b-a3b`. A server response alone is insufficient. Source: `agent/extensions/harness-health.ts:518`.

`/health close` clears the health widget/status in any mode. Starting health probes is YOLO-only and acquires an operation lease; session replacement/cancellation checks occur before and after work. It always releases operation state, discards late results, and does not publish a cancelled report. Persistent errors are redacted. The widget respects the ten-line budget; widths at least 56 may include identity, while required version and remediation remain visible. A Mastra implementation must preserve leases, mode checks and cancellation around readiness probes, not treat health as unrestricted startup automation. Source: `agent/extensions/harness-health.ts:684`, `agent/extensions/harness-health.ts:755`.

## Optional Herdr plugins and workspace panes

The `integrations/herdr-*` packages are opt-in source plugins, outside the managed production runtime graph. `install.ps1` does not activate them. Their presence does not mean the owner's running Herdr layout/plugin state was inspected or changed. They must survive migration independently of the main agent framework. The interactive Neura bridge inside `agent/extensions` is a separate integration surface covered with core UI/runtime behavior.

### Branding and sidebar presentation

`neura.branding` version `0.2.0`, minimum Herdr `0.9.1`, supports Windows/macOS/Linux and runs on startup plus pane detected/status-changed/focused events or explicit refresh. `branding.mjs` requires `HERDR_ENV=1` and an absolute existing `HERDR_BIN_PATH`; subprocesses have a 5-second timeout and 2 MiB buffer. It writes only source-owned metadata, never native lifecycle, title, state or session fields. Native Pi is displayed as Neura only when explicit `display_agent` metadata already identifies Neura; generic Pi is not silently relabelled. Icons are Pi `π`, Claude `✳`, Codex `❋`, Gemini `✦`, Hermes `☤`, OpenCode `▣`, fx `ƒx`, DeepSeek `≈`, Neura `N`. Source: `integrations/herdr-branding/herdr-plugin.toml`, `integrations/herdr-branding/branding.mjs:18`.

The branding refresh removes six legacy artwork-row tokens, legacy caption/harness-marker tokens and its own old display-agent value, then sets the current source-owned icon. It snapshots a monotonic sequence before reads, retries reconciliation up to three times with re-read/re-plan, isolates per-pane failure and logs only generic error context. `--clear` is the metadata rollback. Sidebar transformation works on a cloned config, supports six canonical agents (`pi`, `claude`, `codex`, `gemini`, `hermes`, `opencode`), removes standalone legacy artwork rows while rejecting ambiguous mixed rows, inserts icons before native agent tokens, retains custom wordmarks according to exact-hide rules, and enforces 16-row/token/rule limits. Unrelated user overrides survive. fx/DeepSeek use the base/custom layout path. Source: `integrations/herdr-branding/branding.mjs:70`, `integrations/herdr-branding/sidebars.mjs:45`.

### Subscription usage metadata

`neura.usage` version `0.1.0`, minimum Herdr `0.9.0`, supports all three OS families and the same event-driven refresh pattern. It never polls continuously. It requires a trusted absolute existing `HERDR_BIN_PATH`, uses 5-second/64 KiB CLI limits, and 15-second/1,000,000-byte HTTP limits. Only providers represented by active panes are queried: Claude, Codex, Cursor, or a Pi pane carrying an explicitly recognized `usage_provider` token. Other agents do not cause guessed credential/provider queries. Source: `integrations/herdr-usage/herdr-plugin.toml`, `integrations/herdr-usage/usage-report.mjs:16`, `integrations/herdr-usage/usage-report.mjs:182`.

The source reads provider credentials only at use: Claude's `.claude/.credentials.json` OAuth field, Codex `auth.json` below `CODEX_HOME` or `.codex` using its access token/claims, and Cursor `auth.json` in its platform configuration locations. It does not refresh/write credentials, and API keys are not substituted for the subscription tokens. The read-only endpoints are Anthropic `/api/oauth/usage`, ChatGPT `/backend-api/wham/usage`, and Cursor `/api/usage-summary`. Do not copy token/account contents into this reference, logs or metadata.

Normalization reports rounded/clamped remaining usage, using actual returned windows. Codex percentages must be within 0..100; 168-hour windows are labelled weekly, other known durations in hours, and unspecified windows Primary/Secondary rather than inventing a weekly quota. Cache TTL is 120,000 ms. Cache state is under `HERDR_PLUGIN_STATE_DIR` or a temporary/home fallback; it contains rendered provider text, timestamps, credential revision metadata (`mtime`, `ctime`, size, inode) and pane IDs, never tokens, account objects, raw responses or credential paths. Cache hits retain remaining TTL instead of renewing it. Forced refresh bypasses freshness; failed fetches invalidate cached usage. Missing Codex credentials produce an explicit unavailable token. Stale pane metadata is cleared with retries. Source: `integrations/herdr-usage/usage-report.mjs:114`, `integrations/herdr-usage/usage-report.mjs:150`, `integrations/herdr-usage/usage-report.mjs:206`.

This metadata integration is not the agent's model authentication adapter. Its existence does not prove that Mastra can run models through ChatGPT subscription authentication. That remains a separate parity gate.

### Notes and Calendar panes

`neura.workspace` version `0.1.0`, minimum Herdr `0.9.1`, currently declares Windows support. It exposes explicit open-notes/open-calendar actions and opens a right split. Focus target prefers `HERDR_PANE_ID`, then event context, then workspace context. `open-pane.mjs` uses `HERDR_BIN_PATH` or ambient `herdr` as fallback; unlike branding/usage this is not the same absolute trusted-binary contract. Record that existing difference rather than silently asserting all plugin process resolution is equally restricted. Source: `integrations/herdr-workspace/herdr-plugin.toml`, `integrations/herdr-workspace/open-pane.mjs:5`.

Notes loads only `~/.pi/agent/neura/learn-vault.json` at pane startup. It does not use the core Learn vault override environment path, so changing the main profile root alone does not relocate this consumer. The selected vault must be an absolute local non-UNC canonical directory with `.obsidian`. Scanning skips `.obsidian`, linked directories and hardlinked files; results sort by descending mtime, filter by case-insensitive path substring, and show at most 40. Numeric selection opens the current filtered list in nano. `rN`/`vN` previews that note in Leaf, `/text` filters, `r` refreshes and clears filter, `n` creates, and `q` quits. Source: `integrations/herdr-workspace/notes.mjs:20`, `integrations/herdr-workspace/notes.mjs:48`, `integrations/herdr-workspace/notes.mjs:124`.

Creating a note targets `Herdr Notes/<sanitized title>.md`. Title handling trims, replaces Windows-invalid/control characters with hyphens, removes trailing dots/spaces and caps at 100 characters. Creation is exclusive and writes `# <title>` followed by blank lines; if the path already exists, it opens the existing authorized note instead of replacing it. Every read/edit/preview rechecks a regular `.md` file, link count one, unlinked ancestors and canonical containment. Nano uses fixed Git-for-Windows paths when present then ambient `nano`, without a shell. Leaf is resolved only on explicit preview from absolute native PATH directories, skipping empty/relative entries; Windows accepts `.exe` and its local-programs fallback, while POSIX uses a native Leaf executable/home fallback and never launches a Windows viewer. Preview passes one literal path argument with `shell:false`; errors return to the picker. No background watcher, startup viewer or config/history rewrite is created. Source: `integrations/herdr-workspace/notes.mjs:33`, `integrations/herdr-workspace/notes.mjs:67`, `integrations/herdr-workspace/notes.mjs:94`.

Calendar is an explicit user-operated pane. Documentation names gcalcli `4.5.1`, but executable code checks an absolute `NEURA_GCALCLI_EXECUTABLE` and matching `NEURA_GCALCLI_SHA256`, not version/provenance independently. It rechecks the hash for every operation. Choices are month, two-week view from today, agenda through +14 days with calendar/location, add event, edit matching literal query, list calendars, OAuth init, and quit. The menu calls the CLI directly without shell interpolation; OAuth storage belongs to gcalcli. Add/edit/init are user-triggered external actions, not background model automation. Source: `integrations/herdr-workspace/calendar.mjs:8`, `integrations/herdr-workspace/calendar.mjs:16`.

## Validation, CI and release engineering

### Local test topology and safe execution

`scripts/test-suites.mjs` declares 18 fixed entry points: `unit`, `state-machine`, `integration`, `ui`, `installer`, `sandbox`, `policy`, `plan`, `approvals`, `approval-storage`, `proof`, `fuzz`, `learn`, `learn-materials`, `learn-workshop`, `learn-storage`, `learn-vault`, `learn-end-to-end`. Each is a child Node process with a 180-second maximum. `--suite NAME` accepts only the fixed map; `--changed` maps paths to suites and never turns a filename into executable input. Shared/unknown source selects all; documentation-only edits select none, so documentation validation is separate. Source: `scripts/test-suites.mjs:4`, `scripts/test-suites.mjs:36`, `scripts/verify-harness.mjs:21`.

Tests create synthetic canonical temporary homes, private approval directories and genuine temporary Git repositories. They remove inherited provider credentials and other nonallowlisted environment variables, preserve only basic process/PATH/temp/Git-test overrides, set `NEURA_HEADMASTER=off`, disable system/global Git configuration and prompts, and use synthetic author identities. Separate non-Git fixtures must not have any `.git` ancestor. Exit cleanup removes only generated fixture trees. Tests do not call a provider/model or install into the user's harness. Source: `scripts/tests/isolation.mjs`, `scripts/tests/git-fixture.mjs`.

Integration helpers require local installed `pi-coding-agent`, `pi-ai` and `pi-tui` packages matching both root manifest and runtime contract exactly, reject linked package roots and use the real pinned Pi loader. They do not substitute a global Pi. Their absence is a prerequisite failure, not a regression result and not permission to install dependencies. On Windows, fixture Git commands separately resolve native `git` through PATH; production automatic Git requires the contract-verified binary discussed earlier. A usable PATH alone does not satisfy the production hash gate, and `NEURA_GIT_EXECUTABLE` alone does not put fixture Git on PATH. Source: `scripts/tests/pinned-pi.mjs`, `scripts/tests/git-fixture.mjs`.

The installer suite extracts comparison/version-probe functions from the PowerShell AST and runs them against synthetic data; it does not execute the real installer in the owner's home. It invokes Windows PowerShell in NoLogo/NoProfile/NonInteractive mode with a 60-second bound and explicit script/module context. Nested skill-loader and runtime-install fixtures have their own 60-second bounds. Coverage includes first install, tamper, unknown modules/extensions, allowlist ownership, stale module removal, preservation of private files, copy interruption, repeated recovery interruption, immutable skill upgrades, receipts and path rejection. Passing this suite is not clean-host installation evidence. Source: `scripts/tests/installer.mjs`, `scripts/tests/installer-functions.ps1`, `scripts/tests/runtime-install.mjs`, `scripts/tests/skills.mjs`.

The changed-suite report is written atomically under ignored `.proofofwork/neura-checks.json`, with schema 1, selected suite statuses, timestamp and worktree content fingerprint. The runner compares start/end snapshots; a changing worktree marks evidence unavailable and fails. It rejects linked evidence directories. Reports have no test output or file bodies and are untrusted metadata that cannot grant full proof PASS or skip required proof. Source: `scripts/verify-harness.mjs:29`, `docs/VERIFICATION.md:53`.

The build-agent validation menu is:

```powershell
# Required repository checks after an authorized source/document change:
node scripts\verify-harness.mjs
node scripts\check-docs.mjs
git diff --check

# Full pre-release source checks, with both locked graphs already installed:
npm run typecheck
npm run verify
npm run test:browser
npm run audit:all
npm run check:pi-latest

# Focused existing checks:
node scripts\verify-harness.mjs --suite installer
node scripts\verify-harness.mjs --suite integration
node scripts\verify-harness.mjs --suite policy
node scripts\verify-harness.mjs --suite approval-storage
node scripts\verify-harness.mjs --suite proof
npm run test:herdr
npm run test:release

# Separate live/environment rehearsals; do not run as a side effect of docs work:
npm run verify:sandbox
powershell -File .\install.ps1 -Check
```

`npm run verify` performs typecheck, all harness suites, Herdr tests, release tests and docs checks. Browser verification is separate and requires the real tested Edge environment. `verify:sandbox` is a live WSL2/bubblewrap replay; passing namespace/argument mocks does not establish OS isolation. `install.ps1 -Check` matters only when evaluating live drift; failure never authorizes install. Audits and latest-Pi checks use public network services; they are not offline harness tests. `npm ci --ignore-scripts` and the corresponding nested command are the documented prerequisite setup, but must not be executed during this documentation-only task.

Suite coverage includes real-loader native MCP-disable tests under configuration/CLI/reload/load failure, nested deferred tool authorization, stock-Pi and YOLO positive controls, Gmail mediation, mode persistence, UI width/contrast/line limits, Plan traversal/publication, one-use grants/expiry, six concurrent approval writers, crash lock/partial tail corruption, content-bound receipts/cancellation, and seeded fuzzing (`0x27c0ffee`, 96 path and 96 shell mutation cases). Learn has parser/exercise/storage/vault/browser/cross-mode suites. Preserve behavioral tests, replacing framework fixtures at the adapter seam rather than rewriting all tests to the new implementation's internals. Source: `docs/VERIFICATION.md:22`, `scripts/tests/`.

### CI and maintenance gates

`.github/workflows/verify.yml` runs PR, main push, merge-group and manual checks with read-only repository permissions. Windows Server 2025 has a 25-minute job: full-history checkout without persisted credentials; complete-history secret scan and scanner failure-path tests; Node 24.16.0; hash-verified pinned Git; both locked npm graphs with scripts disabled; high-severity vulnerability audits and registry signature checks for both graphs; latest-stable Pi comparison; actual local Pi version; `npm run verify`; real Plan/Learn browser checks; seven-day Plan accessibility artifact; event-correct whitespace diff; and an ephemeral CI installation plus drift check. Only the disposable runner performs installation, with repository `node_modules/.bin` added to PATH for Pi. This is not authorization for an agent to reproduce installation in a user's live profile.

The Ubuntu 24.04 `portable-proof` job has a 10-minute bound and runs process-contract, proof, approval-storage, sandbox, Learn-storage and Learn-vault contracts. It tests Linux-specific FIFOs/executable bits but is neither full Linux product support nor Windows WSL integration evidence. Dependency review is PR-only. The always-running Required CI aggregator checks all necessary result states, allowing dependency-review skip only where expected. Actions are pinned to immutable commits. Source: `.github/workflows/verify.yml`.

`check-pi-release.mjs` fetches only npm's current stable Pi coding-agent metadata with a 15-second timeout, redirects disabled and 128 KiB body cap; it requires schema 1, exact stable registry version equal to the contract, and equal root pins for coding-agent/AI/TUI. Missing, malformed, oversized, failed or stale evidence blocks the gate. It installs nothing and accepts no override argument. `.github/workflows/pi-compatibility.yml` runs this daily at 07:00 UTC and manually. A future Mastra freshness gate must use a reviewed compatibility policy, not retain a meaningless Pi check or silently float to latest. Source: `scripts/check-pi-release.mjs:8`, `scripts/check-pi-release.mjs:22`.

CodeQL scans JavaScript/TypeScript with no-build mode on PR/main push/merge group and weekly Monday 04:23. Dependabot schedules root npm Monday 05:00, nested Learn 05:15 and GitHub Actions 05:30, with five open PRs per ecosystem scope and grouped coupled Pi/actions updates. Updates must change exact pins, locks, contracts, tests and documentation together. New runtime dependencies require source/lifecycle review and tests, not just a lockfile. Source: `.github/workflows/codeql.yml`, `.github/dependabot.yml`, `docs/DEPENDENCIES.md:416`.

The secret scanner is Gitleaks `8.30.1`; its Windows x64 archive SHA-256 is `d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e`. The script verifies the archive before extraction, scans `git --log-opts --all`, fully redacts findings and bounds scanning to 180 seconds. A leak exit or operational failure is propagated; Windows PowerShell native stderr handling must not mask the native exit code. The tool caches only under runner/temp paths. Do not run this as an unexplained download during a documentation task. Source: `scripts/verify-secrets.ps1`, `scripts/verify-secrets.tests.ps1`.

### Release packaging and rollback

`VERSION`, root `package.json`, and both root lock version fields must agree. The nested Learn package/lock version agreement is independent. Release checks require correctly annotated `v<version>` tags targeting the intended main commit, correct release-note channel and explicit safety statements. Stable release remains blocked unless status explicitly says stable-ready and no not-production-ready condition remains. The current candidate is prerelease and Human Away remains preview-only. Source: `scripts/verify-release.mjs`, `docs/RELEASING.md`, `CHANGELOG.md`.

`.github/workflows/release.yml` validates the annotated tag and workflow SHA, reruns Windows gates and ephemeral installation, then packages from Git on Ubuntu. Artifacts include deterministic gzip (`gzip -n -9`) source tarball, Windows-friendly source ZIP under `neura-v<version>`, SPDX SBOMs for root and nested lock graphs, release notes and sorted SHA-256 checksums. Source archives are not standalone runtime installers. Artifact names are tied to the workflow attempt and expire after three days. Only the final release job has content-write permission, revalidates the remote annotated tag commit and its own latest matching unexpired artifact, and creates a draft prerelease. It does not publish an npm package or automatically declare a stable release. Source: `.github/workflows/release.yml`, `scripts/tests/verify-release.test.mjs`.

Rollback stops every Neura process, approval writer and external automation first. Prepare the previous known-good tag in a separate worktree, install its locked graphs with scripts disabled and run its documented verifier; older tags may lack a Learn graph. Only with owner authorization install that tag, then run `install.ps1 -Check`, and record why rollback happened. Do not rewrite history/delete the failed tag. Never repair/discard an invalid approval tail to make rollback pass; older writers may not honor current locks. Preserve private Learn data and additive proof receipts even when older code ignores them. Framework migration needs an explicit state-format/credential/session rollback plan before activation. Source: `docs/RELEASING.md:146`, `docs/VERIFICATION.md:117`.

The remaining release blockers include complete installer/runtime ownership and cross-component atomicity (#21), transactional/resource-bounded Human Away (#24), approval integrity (#33), credentials (#34), ingress/memory/redaction/MCP (#29), strict typing (#26), durable recovery (#28), evaluation/operations (#30), and a trusted complete full-proof contract (#91). Full verified proof PASS remains unavailable with the current proof runner even if it reports legacy `passed:true`; quick detector PASS is not delivery proof. Production requires a disposable clean-Windows artifact install, hash/version checks, adversarial/browser/secret checks, all-mode and provider workflows, interruption/recovery/rollback, live manifest equality and a bounded soak with observed failures/latency/interventions/resource use. Mastra selection alone closes none of these gates. Source: `docs/PRODUCTION_READINESS.md`, `docs/VERIFICATION.md:65`.

## Migration work allocation for these surfaces

Keep Neura-owned policy, manifests, ownership receipts, skill validation, health classification, bounded probe implementations, plugin metadata normalization, release packaging and behavioral tests where they remain applicable. Replace Pi-specific launch flags, package registration, skill command-registry inspection, session/extension event adapters, provider/authentication calls, native terminal/editor integration, subagent processes and context/redaction/LSP adapters. Rework compatibility pins and the public freshness gate around the reviewed Mastra packages without weakening exact-version ownership. The installer can retain its managed-file engine, but a Mastra graph and profile migration need explicit receipt coverage and recovery; do not silently repoint a `.pi` path and call migration done.

Acceptance must cover a clean machine and repeat install; interrupted managed activation and post-activation configuration; stale/unknown/tampered files; immutable skill updates and collisions; settings/model/provider preservation; plain-host activation separation; exact Git mismatch; missing browser/WSL/OCR/provider; optional health degradation; cancellation/session replacement while probes run; opted-out skills; plugin metadata retry/TTL behavior; Leaf/nano/gcalcli missing or tampered; and old-version rollback with private stores retained. Subscription usage display and actual model subscription authentication are distinct tests.

### Installation and integration source coverage

Read source/manifests: `AGENTS.md`; `package.json`; root lock metadata; `tsconfig.json`; `VERSION`; `agent/settings.json`; `agent/keybindings.json`; `agent/mcp.json`; `launcher/neura.cmd`; `install.ps1`; `agent/neura/runtime-contract.json`; `agent/neura/release-manifest.json`; `agent/neura/runtime-install.mjs`; `agent/neura/package.json`; nested lock metadata; `agent/neura/skills-manifest.json`; `agent/neura/skills-registry.mjs`; `agent/extensions/skill-doctor.ts`; `agent/extensions/harness-health.ts`; executable-resolution portions of `agent/neura/process-security.ts`.

Read validation/automation: `scripts/test-suites.mjs`; `scripts/verify-harness.mjs`; `scripts/check-docs.mjs`; `scripts/check-pi-release.mjs`; `scripts/verify-release.mjs`; `scripts/verify-secrets.ps1`; `scripts/tests/isolation.mjs`; `scripts/tests/git-fixture.mjs`; `scripts/tests/pinned-pi.mjs`; `scripts/tests/installer.mjs`; `scripts/tests/installer-functions.ps1`; focused assertion inventories in `scripts/tests/runtime-install.mjs` and `scripts/tests/verify-release.test.mjs`; `.github/workflows/verify.yml`; `.github/workflows/release.yml`; `.github/workflows/pi-compatibility.yml`; `.github/workflows/codeql.yml`; `.github/dependabot.yml`.

Read all three optional plugin manifests and READMEs, plus `integrations/herdr-branding/branding.mjs`, `sidebars.mjs`; `integrations/herdr-usage/usage-report.mjs`; `integrations/herdr-workspace/open-pane.mjs`, `notes.mjs`, `calendar.mjs`. Read project guidance/status and relevant sections of `docs/STATUS.md`, `PRODUCTION_READINESS.md`, `INSTALLER_READINESS.md`, `DEPENDENCIES.md`, `SKILLS.md`, `VERIFICATION.md`, `RELEASING.md`, `LEARN_DEPENDENCIES.md`. Dependency lock metadata was inspected without dumping entire transitive graphs; this is not a new full dependency audit. No live private profile, credential value, session, approval log, memory record or provider account was read. Source inspections are distinct from the final verification record below. No installation, live drift check, external mutation or migration implementation occurred.


## Public command, configuration, and persistence index

This index is a navigation aid to the detailed contracts above, not an alternate authorization layer. Each handler still owns its mode, input, idle-state and lifecycle checks.

| Neura command | Purpose / meaningful arguments |
|---|---|
| `/dash` | Toggle the branded task-entry surface |
| `/notices [close]` | Show bounded notices or close their widget |
| `/launcher` | Search public commands and explicit modes; stage prompt/skill text without overwriting a draft |
| `/mode [plan\|work\|yolo\|human-away\|learn\|next\|status]` | Choose/query mode, preserving confirmation and lease rules |
| `/approvals [audit\|close\|approve ID\|deny ID\|dismiss ID]` | Inspect or resolve pending action records; approval is an exact retry grant |
| `/preset [gpt\|opus\|qwen]` | Select the configured provider/model preset |
| `/clip [answer\|code]` | Copy latest assistant answer or choose a fenced block |
| `/ship` | Request isolated full proof; never publish/commit |
| `/undo [list]` | List current-process raw snapshots, or restore the newest one; restoration requires YOLO and does not open a selector |
| `/health [close]` | Run host diagnostics in YOLO, or close its display |
| `/skill-doctor` | Read-only validation of opt-in supported skill registration |
| `/memory`, `/remember TEXT` | View/append fixed machine-local memory in YOLO |
| `/mcp` | Third-party command through Neura's YOLO lifecycle wrapper; upstream subcommands need adapter-level verification |
| `/learn ...` | Status, hint, reveal, answer, answer-helped, explain, deeper, example, save, saved, resume, reset; revision-bound browser variants described in Learn |

Native runtime commands, extension package commands and prompt/skill commands are separate from this Neura-owned list. Their existence/semantics must be inventoried before removing Pi. UI labels alone do not establish a supported command.

| Configuration name | Ownership and meaning |
|---|---|
| `NEURA` | Truthy activation gate for Neura extensions; launcher sets `1` |
| `PI_CODING_AGENT_DIR` | Current generated agent-target override; several fixed `.pi` consumers do not follow it |
| `NEURA_REDUCED_MOTION` | Exact value `1` bypasses animated mode transition |
| `NEURA_COST_WARNING` | Positive finite displayed-cost warning threshold, not execution budget |
| `NEURA_APPROVAL_DIR` | Approval journal directory override |
| `NEURA_HEADMASTER` | Case-insensitive `off` disables reviewer invocation and leaves cases deferred |
| `NEURA_GIT_EXECUTABLE` | Candidate absolute Git executable; Windows hash/version gate still applies |
| `NEURA_WSL_DISTRO` | Validated optional WSL distribution selection |
| `NEURA_WSL_UV_DIR`, `NEURA_WSL_PROOF_WHEELHOUSE` | Reviewed offline proof runtime paths; identity/mount checks still apply |
| `NEURA_LEARN_VAULT` | Opt-in vault override; takes precedence over machine-local JSON in the core Learn path |
| `MY_PI_MCP_EAGER_CONNECT` | Temporarily suppressed by Neura wrapper, then previous value restored |
| `MY_PI_MCP_ENV_ALLOWLIST` | Comma-separated approved environment-variable names for credential placeholder resolution in health probes |
| `HERDR_ENV`, `HERDR_PANE_ID`, `HERDR_BIN_PATH` | Explicit Herdr host/pane/native executable integration; exact requirements differ between bridge/plugins |
| `HERDR_PLUGIN_STATE_DIR`, `HERDR_PLUGIN_EVENT_JSON` | Optional plugin-owned cache/event inputs; never model authority |
| `OCTOBER_BUS_PORT`, `OCTOBER_BUS_CANVAS`, `OCTOBER_BUS_NODE`, `CAMPFIRE_SESSION_ROLE` | Optional October bus activation/routing; absence or non-host role disables relevant bridge |
| `NEURA_GCALCLI_EXECUTABLE`, `NEURA_GCALCLI_SHA256` | Explicit calendar binary and per-operation hash expectation |
| `CODEX_HOME` | Herdr usage reader's Codex profile override; not a replacement model-login contract |
| `PI_SKIP_VERSION_CHECK` | Set in the Windows Terminal profile; Neura's own exact runtime check remains required |

Standard OS environment values and test-only fault injection variables are not ordinary product settings. `NEURA_INSTALL_TEST_FAIL_PREPARE_AFTER`, `NEURA_INSTALL_TEST_FAIL_AFTER`, `NEURA_INSTALL_TEST_CRASH_AFTER`, `NEURA_INSTALL_TEST_CRASH_DURING_COPY`, and `NEURA_INSTALL_TEST_CRASH_DURING_RECOVER` deliberately interrupt synthetic installer tests; do not expose them as user migration options. Provider credentials belong to reviewed provider-specific storage, never this document.

| Data surface | Scope, durability, and migration caution |
|---|---|
| `agent/neura/NEURA.md`, runtime/skills/release manifests, theme/artwork | Repository-owned static assets; exact installed ownership where managed |
| `~/.pi/agent/settings.json`, keybindings and MCP config | Machine profile; merge/retain user choices, never replace blindly |
| `~/.pi/agent/neura/approvals/audit.jsonl` and writer lock, or configured directory | Durable bounded-content decision journal; grants remain process-local; corruption/leftover lock fails closed |
| `~/.pi/agent/neura/MEMORY.md` | Raw YOLO memory; private and not authoritative instructions in a new runtime |
| `~/.pi/agent/neura/learn-vault.json` | Opt-in machine-local vault path config, not raw lesson storage |
| Workspace `plans/*-plan.html` | Published documents; ownership/hash metadata lives in session records; preserve externally edited files |
| Workspace `.neura-learning/` | Owned HTML boards and explicit JSON snapshots; restored history is untrusted evidence |
| Vault `Neura/_System/events` plus managed Markdown projections | Append-only minimized events and recoverable projections; preserve user edits/unrelated notes |
| OS-temp `neura-ckpt-*`, `neura-rollback-*` | Temporary raw copies; active metadata is process-local; not durable restart recovery |
| Workspace `.proofofwork/neura-checks.json` | Untrusted supplementary suite metadata; cannot grant proof PASS |
| Pi session journal/custom entries/tree | Runtime-owned conversations plus Neura mode, Plan, and proof events; legacy import/retention unresolved |
| Pi context sidecar and package delegation state | External package formats; preserve bytes and audit public schemas before conversion |
| Installation receipt, managed transaction backups/journal, skill enablement and extension allowlist | Machine-local ownership/recovery controls; several paths remain rooted under `.pi` even with target override |
| Herdr metadata/cache, October service state | Separate optional integration ownership; cache is disposable, external service tasks are not local session records |

No export/import command is currently implemented for a unified Neura application state. A future migration must explicitly preserve each durable surface instead of assuming that copying a Mastra thread also copies approvals, files, vault history, provider credentials and installer ownership.

## Mastra mapping and implementation decisions

Mastra is the selected destination, not an already validated runtime. The least-maintenance approach is to reuse Neura's policy, renderer, schema, storage and sandbox modules, then replace the Pi-dependent orchestration, terminal and provider adapters. Do not rewrite established filesystem/security mechanisms merely to use a framework abstraction.

### Verified framework facts and boundaries

- Mastra Agent Controller provides live sessions, modes, model selection, permissions, threads and subagents. Stored messages and selected thread settings can persist. Arbitrary session state, grants, pending approvals and active runs do not automatically survive process recreation. These distinctions require Neura-owned recovery decisions. [Controller documentation](https://mastra.ai/docs/harness/agent-controller).
- Agent-level `beforeToolCall` can block execution. This is a potential attachment point for Neura's deterministic inspection, not proof it covers every nested, resumed, workspace or externally executed tool in the final integration. [Tool hooks](https://mastra.ai/blog/introducing-tool-hooks).
- Mastra's own approval guidance calls for binding approval to exact tool arguments and consuming a durable, scoped fingerprint once. Native category grants do not replace Neura's stronger action binding. [Approval guidance](https://mastra.ai/docs/agents/human-in-the-loop).
- Native `submit_plan` expects an agent-written file path and can transition modes. That is not Neura's structured, controlled `publish_plan` lifecycle; keep the Neura contract instead of exposing ordinary Plan writes. [Controller documentation](https://mastra.ai/docs/harness/agent-controller).
- Mastra Code SDK source has ChatGPT/Codex OAuth login, device flow, refresh and provider transport. This is a concrete reuse candidate, not a tested authentication adapter for Neura. [Login source](https://github.com/mastra-ai/mastra/blob/4c22623ea342a0ce611e15f89f4ab8b377bf7ee8/mastracode/sdk/src/auth/providers/openai-codex.ts), [provider source](https://github.com/mastra-ai/mastra/blob/4c22623ea342a0ce611e15f89f4ab8b377bf7ee8/mastracode/sdk/src/providers/openai-codex.ts).
- Ready-made Mastra Code TUI currently declares `@earendil-works/pi-tui`; reusing it unchanged does not remove Pi. Code SDK also brings a broader graph than core alone. [TUI manifest](https://github.com/mastra-ai/mastra/blob/4c22623ea342a0ce611e15f89f4ab8b377bf7ee8/mastracode/tui/package.json), [Code SDK manifest](https://github.com/mastra-ai/mastra/blob/4c22623ea342a0ce611e15f89f4ab8b377bf7ee8/mastracode/sdk/package.json).
- Mastra core is Apache-2.0; directories named `ee/` have a separate enterprise license. Keep open-source distribution scope explicit and review the actually selected package closure. [License mapping](https://github.com/mastra-ai/mastra/blob/4c22623ea342a0ce611e15f89f4ab8b377bf7ee8/LICENSE.md).

Research on 2026-10-23 found npm stable `@mastra/core` 1.79.0 and `@mastra/code-sdk` 1.15.0, while repository `main` already carried newer alpha metadata. These numbers are discovery evidence, not approved migration pins. Select and review exact versions together when implementing, verify source-to-published-package correspondence, and retain lockfiles/integrities. Do not copy code from moving `main` while claiming a stable package supplied it.

### Concrete adaptation map

| Existing Pi seam | Required Mastra-side behavior | Reuse boundary |
|---|---|---|
| `ExtensionAPI.on`, commands and tool registration | Attach lifecycle callbacks and register only intended public tools/commands | Feature handlers can be adapted; do not emulate unrelated Pi internals |
| `ctx.cwd`, current mode, abort signal, session identity | Supply trusted workspace/context and per-session ownership to each operation | Existing policy/tool signatures should receive explicit trusted values |
| `setActiveTools`, provider payload filtering | Derive exposed tool list from mode; maintain final execution guard | `mode-tools.ts`, capability metadata and deterministic policy remain authoritative |
| Pi native read/grep/find/ls/bash definitions | Replace underlying implementations while preserving concrete-file checks, bounds and output contracts | Plan wrappers must not become a generic unguarded workspace tool |
| `appendEntry` and branch reads | Store versioned mode, Plan and verification records with their correct lifecycle | Keep event schema semantics; never treat stored approvals as self-authenticating |
| `sendUserMessage` follow-ups | Queue at most permitted retries and retain source/type of input | Plan retry and proof feedback budgets remain separate |
| `agent_end` / `agent_settled` | Distinguish intermediate completion from whole-run idle settlement | Do not run proof or final missing-artifact reporting too early |
| UI context/select/custom/widgets/footer/editor | New terminal presentation and command dispatch | Pure rendering, labels, colors, copy parsing and state logic are reusable after width-helper replacement |
| Model runtime/login/presets | Multiple-provider sessions, explicit authentication, local endpoint and subscription adapter | Preserve preset resolution/error behavior; no API-billing substitution |
| Pi Headmaster subprocess | Trusted isolated reviewer with zero tools/resources | Keep sanitized dossier, bounded verdict parsing and clamp |
| Pi MCP wrapper/package | Owned MCP adapter with explicit discovery and lazy execution gating | Keep connection/credential rules; avoid built-in eager network startup |
| Pi subagent runtime | Equivalent delegation with descendant policy and cancellation | Never allow a child to receive wider tools merely because framework supports it |
| Pi resource/skill discovery | Supported registry plus identity checks | Keep immutable manifests and default-disabled opt-in selection |
| Runtime installer and launcher | New reviewed package/runtime identity and managed install target | Preserve ownership checks, untouched user files, rollback and fail-closed startup |

Do not introduce a full compatibility framework, new database, service bus, hosted backend or multi-user system solely to port these seams. Use the minimum framework API surface needed by real Neura features. Conversely, do not leave a feature unimplemented merely because it is inconvenient to fit a native abstraction.

### Open decisions that an implementation agent must resolve explicitly

1. **Terminal library:** choose a maintained Pi-independent renderer/editor with Windows input/IME, Unicode width, clipboard and accessibility behavior. Reusing the Mastra Code terminal violates the current full-removal assumption.
2. **Subscription adapter:** establish stable imports, supported transport, refresh and safe credential persistence. Test device/browser login, expired credentials, model entitlement and session restart; do not inspect or copy real tokens during development.
3. **State backend and legacy data:** select application-controlled persistence for conversation history and Neura records. Preserve old user files. Test an explicit import or clearly documented read-only legacy path; never silently discard history, memory, learning snapshots or context sidecars.
4. **Crash semantics:** decide where a run becomes durably pending, approved, executing, completed or uncertain. A crash after a mutation but before a saved result must not silently rerun that mutation. Existing Neura has durable-recovery gaps; a thread-storage feature does not close them.
5. **Process cancellation:** choose how Windows/WSL descendant cleanup will be proved. Existing `execFile` timeout semantics do not establish a hard process-tree deadline.
6. **Provider-neutral history:** test switches between GPT, Claude and local Qwen, including reasoning/tool-result formats, compaction, images and partially completed calls. Do not relabel incompatible histories as successful switches.
7. **Data export and tracing:** preserve privacy before enabling any framework telemetry, memory embedding or automatic tracing sink. Audit actual defaults and redact/exclude sensitive application state before persistence or export.
8. **Policy scope:** remain personal/single-user unless explicitly expanded. If multiple Controller sessions exist in one process, isolate global Neura mode/cockpit/grant state rather than sharing authority across sessions.

### Implementation order and acceptance gates

Build a headless boundary slice first, then restore UI and optional integrations. This is a recommended sequence, not authorization to start implementing from this documentation-only task.

| Gate | Implement / prove | Exit condition |
|---|---|---|
| 0. Freeze baseline | Exact dependency review, source identity, synthetic baseline fixtures, current blockers | No feature silently dropped; reproducible test environment; privacy-safe fixtures |
| 1. Tool boundary | Work default, all five mode selections, final deterministic dispatch, canonical paths | Every denied case prevents side effects; permitted controls still work |
| 2. Approval and lifetime | Exact grants, corruption/crash handling, session generation, cancellation/drain | Changed arguments/target/workspace/mode cannot reuse approval; stale result cannot enter new session |
| 3. Provider parity | GPT subscription, Claude, local Qwen, streaming/thinking/history | Actual selected provider works; missing credentials fail safely; no hidden paid-API fallback |
| 4. Plan | Full schema/publication ownership, retry and final machine outcomes | Interactive/print/JSON/RPC request tests pass; no unauthorized write path |
| 5. Learn | Import/OCR/citations/exercises/boards/save/resume/vault | All bounded positive/negative tests and real browser checks pass |
| 6. Execution/proof/recovery | WSL sandbox, offline runtime, receipts, checkpoints/undo | No host fallback; no false full PASS; interrupted restore preserves user bytes |
| 7. Terminal | Startup, commands, approvals, footer/cost, notices, copy, keybindings | Width/IME/focus/accessibility tests pass; no Pi TUI dependency remains |
| 8. Integrations | MCP, Gmail, memory, skills, LSP/search/delegation/context, October, Herdr | Each declared feature works or remains explicitly optional/unavailable; no eager permission expansion |
| 9. Distribution | Exact lockfiles, manifest, new launcher/installer, interrupted install/upgrade/rollback | Clean Windows rehearsal and manifest checks pass; existing Pi/user data remains intact |
| 10. Release judgment | Independent review, dependency/security checks and documented limits | Required production gates decide readiness; framework migration alone does not |

Minimum adversarial cases span every gate:

- Tool alias, provider payload shape, nested/deferred invocation, tool-search activation, reload, restored tool list, malformed schema, unknown tool and failed replacement loader.
- Junction/symlink/hardlink/ADS/UNC cases where applicable; ignored tracked files; global excludes; historical Git content; changed paths between inspection and delivery.
- Tool arguments changed after approval, replayed/expired grants, target bytes or inode changed, index/HEAD/workspace changed, corrupt approval tail, crash lock and concurrent writers.
- Mode switch or session replacement during pending review, parser work, proof, diagnostics, import, publication and checkpoint restore; no stale late callback.
- Provider failure, tool nonzero exit, timeout, cancellation, output limit, missing executable and missing sandbox distinguish completed failure from unavailable evidence.
- Process crash before action, during action, after action but before persistence, and after persistence before UI acknowledgment. Unknown external effect remains unknown rather than auto-retried.
- Browser stale revision, copied command replay, unsafe HTML/URL, inaccessible diagram, malformed image, malicious archive/document, SQL filesystem/network/write attempt, unowned store/vault and modified projection.
- Optional integration absent/unconfigured/unhealthy versus required core failure; credentials never in UI/logs/model state/saved snapshots by accident.

## Known discrepancies and unresolved production work

These are findings to preserve in the handoff, not changes made by this documentation task.

| Area | Actual baseline / required caution |
|---|---|
| Design palette | `DESIGN.md` describes copper; current tokens/theme/tests require logo blue |
| Launch height | Ten-line cap is for widgets; centered custom editor includes vertical padding and is tested by visible content, not total rows |
| Settlement | Current cockpit completes on idle `agent_settled`, despite older overview language naming `agent_end` |
| Checkpoints | Current implementation copies raw bytes to OS-temp; older architecture storage table says Git objects |
| Skill doctor | Current read-only command works without YOLO; some Learn/support prose still describes skill scans/reports as YOLO-only |
| Approval writer deadline | Actual source contention deadline is ten seconds; security prose mentions two seconds |
| Work confirmation race | Current async Work confirmation does not itself prove a second action-binding computation immediately before execution; do not claim that guarantee |
| Plan/Learn lifetime | Plan publication has no session-generation fence after asynchronous writes; some Learn vault/profile awaits also lack a final guard. Current generation checks are partial, not a universal stale-result guarantee |
| Process cancellation | Node callback/lease completion is not attestation that all descendants terminated |
| Memory/October | Existing raw memory/context integration and October lifecycle have hardening gaps; generic lease/redaction claims must not be applied to every integration |
| Proof | Full trusted PASS unavailable with pinned legacy runner; detector-only success is not engineering completion |
| Installer | Managed activation recovery exists but settings, Terminal resources and cross-component activation are not one atomic transaction |
| Human Away | Live writable workspace and repository script indirection remain production blockers despite bubblewrap |
| Dependencies | Exact source pins and historical audit results do not prove current installed packages or live compatibility |

Production backlog from `docs/PRODUCTION_READINESS.md`: P0 Human Away transactional/resource safety (#24) and complete runtime manifest/atomic install/rollback (#21); P1 approval integrity (#33), Gmail/provider credentials (#34), prompt ingress/memory/redaction/MCP (#29), strict typing (#26), durable recovery (#28), evaluations/operations (#30). Full proof delivery remains #91. Issue status here comes from the checked-in status documents, not a fresh remote issue audit.

Neura may only be called production-ready after required P0/security-critical P1 acceptance, clean install/upgrade/interruption/rollback/live-manifest checks, typing/adversarial/dependency/signature/secret/docs/CI checks, reviewed source/live identity, and truthful release notes. Human Away has its own preview gate. Framework branding, a green subset of tests or a version bump cannot waive these conditions.

## Handoff instructions for an implementation agent

1. Treat this file as a detailed map of current behavior, not permission to deploy or modify user data. Re-read repository instructions and current status at the implementation revision.
2. Keep current user work and legacy installation intact. Build in an isolated source branch/worktree when implementation is authorized. Do not import private sessions or credentials as test fixtures.
3. Choose a bounded feature slice and list callers, schemas, storage, UI, config, exports and tests affected. Reuse current modules before adding abstractions or dependencies.
4. Establish exact Mastra/package versions and reviewed import surfaces. Reject transitive Pi packages if full removal remains required. Do not introduce an enterprise dependency into open-source distribution accidentally.
5. Port positive and negative tests to real Mastra execution, not just hook mocks. A hidden tool is not a blocked tool; a native permission label is not action authorization.
6. Preserve current semantic event/result contracts across CLI/TUI/machine interfaces. Define data migration and rollback before replacing persisted state formats.
7. Update runtime identity, dependency locks, managed manifest/hashes, installer and CI together when their assumptions change. Do not bypass a failing prerequisite check to make a demo run.
8. Report what actually passed, what failed, and what remains unverified. Keep source-only, live-installed, release and production claims separate.

The first useful proof is a denied action that never executes, a permitted action that does execute, and a resumed action that cannot reuse stale authority. A polished terminal alone is not migration success.

## Verification performed for this reference

- Source audit covered all 19 Neura extension entry points, their shared implementation modules, current configuration, installation/distribution paths, optional Herdr code and relevant regression suites. Historical plans were not treated as requirements. External package internals were not exhaustively audited.
- `node scripts/verify-harness.mjs` was attempted on 2026-10-23 with Node `24.19.0`. Overall result: **FAILED**, because required root and Learn dependencies are not installed in this checkout. Four independent suites passed: sandbox contract, approval-storage, learn-storage and learn-vault. The other 14 suites failed to load required packages such as Pi, TypeBox or `@napi-rs/canvas`. No dependency installation or global-Pi fallback was performed.
- The passing sandbox suite is a contract test, not a live WSL replay. The passing storage suites exercise synthetic data, not private user stores.
- `node scripts/check-docs.mjs` passed: all 42 Markdown files, local links, version/release claims and managed-source hashes checked. `git diff --check` passed for tracked changes; a separate check covered whitespace in this new file. Leaf's noninteractive Markdown render completed successfully. Additional document assertions passed for all 19 extension names and 41 shared-directory file names, 25 consistent tables, local source line references, contents anchors, closed code fences and trailing whitespace. Filename coverage is a completeness aid, not a claim that every dependency or test body was exhaustively audited.
- No live drift check, real provider login, model call, browser suite, real OCR workload, full dependency audit, release rehearsal or Mastra prototype was performed. No live harness, remote system, commit, tag or release was modified.

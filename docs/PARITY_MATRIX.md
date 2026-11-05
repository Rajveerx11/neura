# Pi-to-Mastra parity acceptance matrix (M0)

Matrix version 1, 2026-11-05. Owner issue: [M0 #114](https://github.com/Rajveerx11/neura/issues/114),
epic [#113](https://github.com/Rajveerx11/neura/issues/113).

Frozen baseline: `3ebaac07c8320125bcc32478b5aa3865746a997c` (Pi `1.3.0`, candidate
`2.6.0-rc.1`). Every source link below is a permalink to that commit. Current status
describes the Mastra v1 source on `main`, not the baseline.

**This matrix does not certify unrun tests, does not claim parity, and closes no
hardening issue.** An evidence path names an existing test that exercises some part of
the row; it is not a recorded PASS for the full baseline behavior. Human Away remains
preview-only and full proof PASS remains blocked by
[#91](https://github.com/Rajveerx11/neura/issues/91). No row is marked `implemented`:
no v1 surface has yet been shown equivalent to its baseline behavior.

`node scripts/check-parity-matrix.mjs` derives the 19 extension entry points and the
command names from Git at the frozen commit and fails if any is missing, duplicated,
unowned, missing a permalink, links a path absent from the frozen tree, uses an unknown
status, names a non-test evidence file, or marks Human Away or full proof `implemented`.

## Status values

| Status | Meaning |
|---|---|
| `implemented` | v1 provides the baseline behavior and a non-mock test covers it |
| `partial` | v1 provides part of the behavior, or its evidence is synthetic or mock-only |
| `unavailable` | Baseline behavior depends on a mode or gate v1 refuses or that is blocked: Plan, YOLO, Human Away, full proof, or the removed Pi profile |
| `future` | No v1 code path yet; porting is pending under its owner |

Evidence is `none` when no current test covers the row. Fixture is `needed` when no
existing synthetic fixture covers it. Mock-only evidence is `partial` at best. An API-key
provider is never subscription-authentication evidence.

## Extension entry points (19)

| ID | Baseline source | Owner | Status | Evidence | Fixture | Notes |
|---|---|---|---|---|---|---|
| `ext:neura.ts` | [agent/extensions/neura.ts](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/neura.ts) | [M10](https://github.com/Rajveerx11/neura/issues/124) | `partial` | `tests/v1-cli.test.ts` | `tests/cli-interactive-fixture.mjs` | v1 has the approved logo launch and prompt-adjacent status. No startup editor, `/dash`, `/notices`, launcher or title/theme parity. Persona composition is not ported. |
| `ext:modes.ts` | [agent/extensions/modes.ts](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/modes.ts) | [M2](https://github.com/Rajveerx11/neura/issues/116) | `partial` | `tests/v1-cli.test.ts` | `tests/cli-interactive-fixture.mjs` | Work and Learn only; other modes fail closed. No persisted mode restoration, lease drain or provider-payload tool filtering equivalent. |
| `ext:guardrail.ts` | [agent/extensions/guardrail.ts](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/guardrail.ts) | [M2](https://github.com/Rajveerx11/neura/issues/116) | `partial` | `tests/v1-learn.test.ts` | needed | Work reuses `action-policy`, `action-paths` and `redaction`. Protected Plan tools and the restricted-mode codemode/tool_search denial have no v1 counterpart. |
| `ext:gmail-guardrail.ts` | [agent/extensions/gmail-guardrail.ts](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/gmail-guardrail.ts) | [M12](https://github.com/Rajveerx11/neura/issues/126) | `unavailable` | none | needed | Gmail was reachable only through YOLO MCP. Carried obligation [#34](https://github.com/Rajveerx11/neura/issues/34). |
| `ext:human-away-sandbox.ts` | [agent/extensions/human-away-sandbox.ts](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/human-away-sandbox.ts) | [M6](https://github.com/Rajveerx11/neura/issues/120) | `partial` | `tests/v1-learn.test.ts`, `tests/v1-work-sandbox.test.ts` | needed | `work_exec` behavior is reused by `src/work.ts`. `human_away_exec` is unavailable; see `gate:human-away`. The sandbox test needs a configured host and is not run in PR CI. |
| `ext:plan-artifact.ts` | [agent/extensions/plan-artifact.ts](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/plan-artifact.ts) | [M8](https://github.com/Rajveerx11/neura/issues/122) | `unavailable` | none | needed | Plan mode is refused in v1. |
| `ext:learn.ts` | [agent/extensions/learn.ts](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/learn.ts) | [M9](https://github.com/Rajveerx11/neura/issues/123) | `partial` | `tests/v1-learn.test.ts`, `tests/v1-agent-learn.test.ts` | `scripts/learn-material-fixtures.mjs`, `scripts/learn-workshop-fixture.mjs` | Four Learn tools and `/learn` run on real Mastra with a deterministic model. No branch-tree invalidation (v1 has no session tree). |
| `ext:checkpoint.ts` | [agent/extensions/checkpoint.ts](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/checkpoint.ts) | [M7](https://github.com/Rajveerx11/neura/issues/121) | `unavailable` | none | needed | YOLO-only. Carried obligation [#28](https://github.com/Rajveerx11/neura/issues/28). |
| `ext:check-gate.ts` | [agent/extensions/check-gate.ts](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/check-gate.ts) | [M7](https://github.com/Rajveerx11/neura/issues/121) | `partial` | `tests/v1-verification.test.ts` | needed | Manual `/verify quick` gives detector-only receipts. No automatic proof on settlement. Full proof stays unavailable; see `gate:full-proof`. |
| `ext:cockpit.ts` | [agent/extensions/cockpit.ts](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/cockpit.ts) | [M10](https://github.com/Rajveerx11/neura/issues/124) | `partial` | `tests/v1-terminal-ui.test.ts` | needed | Status shows reported token usage. No cost, cost warning, phase/operation rail or working indicator parity. |
| `ext:transcript-actions.ts` | [agent/extensions/transcript-actions.ts](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/transcript-actions.ts) | [M10](https://github.com/Rajveerx11/neura/issues/124) | `future` | none | needed | No clipboard or code-block extraction in v1. |
| `ext:harness-health.ts` | [agent/extensions/harness-health.ts](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/harness-health.ts) | [M14](https://github.com/Rajveerx11/neura/issues/128) | `unavailable` | none | needed | `/health` ran in YOLO. `neura --check` reaches the runtime only; it is not health parity. |
| `ext:presets.ts` | [agent/extensions/presets.ts](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/presets.ts) | [M4](https://github.com/Rajveerx11/neura/issues/118) | `partial` | `tests/v1-auth.test.ts`, `tests/v1-runtime.test.ts` | `tests/model-fixture.ts` | `/model` and `--provider` replace presets; no `/preset`. Local models need an explicit loopback endpoint. Subscription evidence is synthetic only. |
| `ext:neura-memory.ts` | [agent/extensions/neura-memory.ts](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/neura-memory.ts) | [M12](https://github.com/Rajveerx11/neura/issues/126) | `unavailable` | none | needed | YOLO-only. Carried obligation [#29](https://github.com/Rajveerx11/neura/issues/29). |
| `ext:mcp.ts` | [agent/extensions/mcp.ts](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/mcp.ts) | [M11](https://github.com/Rajveerx11/neura/issues/125) | `unavailable` | none | needed | YOLO lifecycle wrapper around `@spences10/pi-mcp`. |
| `ext:october-bus.ts` | [agent/extensions/october-bus.ts](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/october-bus.ts) | [M12](https://github.com/Rajveerx11/neura/issues/126) | `future` | none | needed | No v1 bus. Carried obligation [#29](https://github.com/Rajveerx11/neura/issues/29). |
| `ext:skill-doctor.ts` | [agent/extensions/skill-doctor.ts](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/skill-doctor.ts) | [M12](https://github.com/Rajveerx11/neura/issues/126) | `future` | none | needed | No v1 skill discovery. |
| `ext:ship-report.ts` | [agent/extensions/ship-report.ts](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/ship-report.ts) | [M3](https://github.com/Rajveerx11/neura/issues/117) | `future` | none | needed | v1 Work instructions contain no end-of-iteration report rules. |
| `ext:herdr-usage-provider.ts` | [agent/extensions/herdr-usage-provider.ts](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/herdr-usage-provider.ts) | [M12](https://github.com/Rajveerx11/neura/issues/126) | `future` | none | needed | No v1 Herdr bridge. |

## Public Neura commands (15)

Fourteen names are literal `registerCommand` calls at the baseline. `/mcp` is registered
by `@spences10/pi-mcp` through the `mcp.ts` wrapper.

| ID | Baseline source | Owner | Status | Evidence | Fixture | Notes |
|---|---|---|---|---|---|---|
| `cmd:/dash` | [neura.ts#L172](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/neura.ts#L172) | [M10](https://github.com/Rajveerx11/neura/issues/124) | `future` | none | needed | Branded task-entry toggle. |
| `cmd:/notices` | [neura.ts#L177](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/neura.ts#L177) | [M10](https://github.com/Rajveerx11/neura/issues/124) | `future` | none | needed | Bounded notices widget. |
| `cmd:/launcher` | [command-launcher.ts#L199](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/neura/command-launcher.ts#L199) | [M10](https://github.com/Rajveerx11/neura/issues/124) | `future` | none | needed | v1 has grouped `/help`, not a searchable launcher. |
| `cmd:/mode` | [modes.ts#L461](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/modes.ts#L461) | [M2](https://github.com/Rajveerx11/neura/issues/116) | `partial` | `tests/v1-cli.test.ts` | `tests/cli-interactive-fixture.mjs` | `work` and `learn` only; `plan`, `yolo`, `human-away`, `next` and `status` arguments are not equivalent. |
| `cmd:/approvals` | [modes.ts#L485](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/modes.ts#L485) | [M5](https://github.com/Rajveerx11/neura/issues/119) | `future` | none | needed | v1 asks per exact Work command; there is no pending-record command or audit view. |
| `cmd:/preset` | [presets.ts#L43](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/presets.ts#L43) | [M4](https://github.com/Rajveerx11/neura/issues/118) | `future` | none | needed | Whether `/model` replaces presets is an open M4 decision. |
| `cmd:/clip` | [transcript-actions.ts#L117](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/transcript-actions.ts#L117) | [M10](https://github.com/Rajveerx11/neura/issues/124) | `future` | none | needed | |
| `cmd:/ship` | [check-gate.ts#L130](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/check-gate.ts#L130) | [M7](https://github.com/Rajveerx11/neura/issues/121) | `unavailable` | `tests/v1-cli.test.ts` | needed | Requests full proof, which is blocked. Evidence covers only v1 `/verify full` failing closed. |
| `cmd:/undo` | [checkpoint.ts#L264](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/checkpoint.ts#L264) | [M7](https://github.com/Rajveerx11/neura/issues/121) | `unavailable` | none | needed | Restoration required YOLO. |
| `cmd:/health` | [harness-health.ts#L758](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/harness-health.ts#L758) | [M14](https://github.com/Rajveerx11/neura/issues/128) | `unavailable` | none | needed | Diagnostics ran in YOLO. |
| `cmd:/skill-doctor` | [skill-doctor.ts#L20](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/skill-doctor.ts#L20) | [M12](https://github.com/Rajveerx11/neura/issues/126) | `future` | none | needed | |
| `cmd:/memory` | [neura-memory.ts#L52](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/neura-memory.ts#L52) | [M12](https://github.com/Rajveerx11/neura/issues/126) | `unavailable` | none | needed | YOLO-only. |
| `cmd:/remember` | [neura-memory.ts#L33](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/neura-memory.ts#L33) | [M12](https://github.com/Rajveerx11/neura/issues/126) | `unavailable` | none | needed | YOLO-only. |
| `cmd:/mcp` | [mcp.ts#L45](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/mcp.ts#L45) | [M11](https://github.com/Rajveerx11/neura/issues/125) | `unavailable` | none | needed | Upstream subcommands are not inventoried; see named gaps. |
| `cmd:/learn` | [learn.ts#L247](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/learn.ts#L247) | [M9](https://github.com/Rajveerx11/neura/issues/123) | `partial` | `tests/v1-learn.test.ts`, `tests/v1-cli.test.ts` | `scripts/learn-workshop-fixture.mjs` | Status, hint, reveal, answer, answer-helped, save, saved, resume, reset and board variants exist; equivalence of every argument is unverified. |

## Modes and release gates

| ID | Baseline source | Owner | Status | Evidence | Fixture | Notes |
|---|---|---|---|---|---|---|
| `mode:work` | [modes.ts](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/modes.ts) | [M2](https://github.com/Rajveerx11/neura/issues/116) | `partial` | `tests/v1-learn.test.ts`, `tests/v1-cli.test.ts` | `tests/cli-interactive-fixture.mjs` | Positive contained-edit cases exist. No headless approval or remote/protected actions. |
| `mode:learn` | [learn.ts](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/learn.ts) | [M9](https://github.com/Rajveerx11/neura/issues/123) | `partial` | `tests/v1-agent-learn.test.ts` | `scripts/learn-material-fixtures.mjs` | Positive real-Mastra lesson, attempt, save and resume case. |
| `mode:plan` | [plan-artifact.ts](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/plan-artifact.ts) | [M8](https://github.com/Rajveerx11/neura/issues/122) | `unavailable` | none | needed | No positive v1 Plan read case exists. |
| `mode:yolo` | [modes.ts](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/modes.ts) | [M2](https://github.com/Rajveerx11/neura/issues/116) | `unavailable` | none | needed | No positive v1 YOLO control case exists. |
| `gate:human-away` | [agent/neura/human-away-sandbox.ts](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/neura/human-away-sandbox.ts) | [M2](https://github.com/Rajveerx11/neura/issues/116) | `unavailable` | `tests/v1-cli.test.ts` | needed | Human Away was preview-only at the baseline and is not supported production behavior. Evidence covers only unavailable modes failing closed. Carried obligation [#24](https://github.com/Rajveerx11/neura/issues/24). |
| `gate:full-proof` | [verification.ts#L139-L155](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/neura/verification.ts#L139-L155) | [M7](https://github.com/Rajveerx11/neura/issues/121) | `unavailable` | `tests/v1-verification.test.ts` | needed | Full proof PASS is blocked by [#91](https://github.com/Rajveerx11/neura/issues/91). Evidence covers the fail-closed path only. |

## Configuration input categories

| ID | Baseline source | Owner | Status | Evidence | Fixture | Notes |
|---|---|---|---|---|---|---|
| `cfg:activation-profile` | [launcher/neura.cmd#L4-L7](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/launcher/neura.cmd#L4-L7) | [M14](https://github.com/Rajveerx11/neura/issues/128) | `unavailable` | none | needed | `NEURA`, `PI_CODING_AGENT_DIR`, `PI_SKIP_VERSION_CHECK`. v1 deliberately ignores the Pi profile and uses `NEURA_HOME`; `scripts/check-pi-free.mjs` checks the launcher. |
| `cfg:settings-defaults` | [agent/settings.json#L2-L3](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/settings.json#L2-L3) | [M4](https://github.com/Rajveerx11/neura/issues/118) | `partial` | `tests/v1-auth.test.ts` | `tests/model-fixture.ts` | Default provider and model. v1 uses `NEURA_PROVIDER`/`NEURA_MODEL` and a catalog default, not a pinned `gpt-5.5`. |
| `cfg:packages` | [agent/settings.json#L4-L14](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/settings.json#L4-L14) | [M11](https://github.com/Rajveerx11/neura/issues/125) | `unavailable` | none | needed | Pi package list; removed with Pi. See the package table. |
| `cfg:skills` | [agent/settings.json#L15-L17](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/settings.json#L15-L17) | [M12](https://github.com/Rajveerx11/neura/issues/126) | `future` | none | needed | Skill exclusions and opt-in enablement. |
| `cfg:ui` | [modes.ts#L200](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/modes.ts#L200) | [M10](https://github.com/Rajveerx11/neura/issues/124) | `future` | none | needed | `NEURA_REDUCED_MOTION`, `NEURA_COST_WARNING`. |
| `cfg:approvals` | [approval-store.ts#L67](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/neura/approval-store.ts#L67) | [M5](https://github.com/Rajveerx11/neura/issues/119) | `future` | none | needed | `NEURA_APPROVAL_DIR`, `NEURA_HEADMASTER`. |
| `cfg:execution` | [human-away-sandbox.ts#L40](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/neura/human-away-sandbox.ts#L40) | [M6](https://github.com/Rajveerx11/neura/issues/120) | `partial` | `tests/v1-learn.test.ts` | needed | `NEURA_GIT_EXECUTABLE`, `NEURA_WSL_DISTRO`, `NEURA_WSL_UV_DIR`, `NEURA_WSL_PROOF_WHEELHOUSE` are read by reused modules. Evidence covers only the unset-distro boundary. |
| `cfg:learn-vault` | [learn-vault.ts#L79-L81](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/neura/learn-vault.ts#L79-L81) | [M9](https://github.com/Rajveerx11/neura/issues/123) | `partial` | `tests/v1-learn.test.ts` | needed | `NEURA_LEARN_VAULT`. v1 reads `learn-vault.json` from the Neura home and refuses Pi aliases. |
| `cfg:mcp` | [mcp.ts#L19](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/mcp.ts#L19) | [M11](https://github.com/Rajveerx11/neura/issues/125) | `unavailable` | none | needed | `MY_PI_MCP_EAGER_CONNECT`, `MY_PI_MCP_ENV_ALLOWLIST`. |
| `cfg:provider-credentials` | [agent/settings.json#L3](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/settings.json#L3) | [M4](https://github.com/Rajveerx11/neura/issues/118) | `partial` | `tests/v1-auth.test.ts` | `tests/model-fixture.ts` | Pi-owned credential storage was not inspected. v1 subscription login is synthetic-tested only. `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` transports are not subscription evidence. No Pi token import. |
| `cfg:herdr` | [herdr-usage-provider.ts#L34](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/herdr-usage-provider.ts#L34) | [M12](https://github.com/Rajveerx11/neura/issues/126) | `future` | none | needed | `HERDR_ENV`, `HERDR_PANE_ID`, `HERDR_BIN_PATH`, `HERDR_PLUGIN_STATE_DIR`, `HERDR_PLUGIN_EVENT_JSON`, `CODEX_HOME`. |
| `cfg:october` | [october-bus.ts#L5](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/october-bus.ts#L5) | [M12](https://github.com/Rajveerx11/neura/issues/126) | `future` | none | needed | `OCTOBER_BUS_PORT`, `OCTOBER_BUS_CANVAS`, `OCTOBER_BUS_NODE`, `CAMPFIRE_SESSION_ROLE`. |
| `cfg:calendar` | [calendar.mjs#L9](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/integrations/herdr-workspace/calendar.mjs#L9) | [M12](https://github.com/Rajveerx11/neura/issues/126) | `future` | none | needed | `NEURA_GCALCLI_EXECUTABLE`, `NEURA_GCALCLI_SHA256`. |
| `cfg:installer-test-faults` | [runtime-install.mjs#L325](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/neura/runtime-install.mjs#L325) | [M14](https://github.com/Rajveerx11/neura/issues/128) | `unavailable` | none | needed | `NEURA_INSTALL_TEST_*` fault injection; test-only, never a product setting. |

## Durable stores and persistence categories

| ID | Baseline source | Owner | Status | Evidence | Fixture | Notes |
|---|---|---|---|---|---|---|
| `store:static-assets` | [agent/neura/NEURA.md](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/neura/NEURA.md) | [M14](https://github.com/Rajveerx11/neura/issues/128) | `partial` | `tests/v1-cli.test.ts` | needed | New approved artwork replaces the old artwork. Persona file and runtime/release manifests are not used by v1. |
| `store:pi-profile` | [agent/settings.json](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/settings.json) | [M13](https://github.com/Rajveerx11/neura/issues/127) | `unavailable` | `tests/v1-learn.test.ts` | needed | Settings, keybindings, MCP config. Deliberately not read; preserved untouched. Evidence covers Pi-alias refusal only. |
| `store:approvals-journal` | [approval-store.ts#L67-L71](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/neura/approval-store.ts#L67-L71) | [M13](https://github.com/Rajveerx11/neura/issues/127) | `future` | none | needed | `audit.jsonl` and writer lock. v1 approvals are process-local; legacy records are never authority. Carried obligation [#33](https://github.com/Rajveerx11/neura/issues/33). |
| `store:memory` | [neura-memory.ts#L10](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/neura-memory.ts#L10) | [M13](https://github.com/Rajveerx11/neura/issues/127) | `unavailable` | none | needed | Raw YOLO `MEMORY.md`; private, never read for migration design. |
| `store:learn-vault-config` | [learn-vault.ts#L81](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/neura/learn-vault.ts#L81) | [M13](https://github.com/Rajveerx11/neura/issues/127) | `partial` | `tests/v1-learn.test.ts` | needed | New Neura-home location; no import of the legacy file. |
| `store:plan-artifacts` | [plan-artifact.ts](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/plan-artifact.ts) | [M13](https://github.com/Rajveerx11/neura/issues/127) | `unavailable` | none | needed | Workspace `plans/*-plan.html` plus ownership metadata in session records. |
| `store:learn-boards` | [learn-store.ts#L6](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/neura/learn-store.ts#L6) | [M13](https://github.com/Rajveerx11/neura/issues/127) | `partial` | `tests/v1-learn.test.ts`, `scripts/tests/learn-storage.mjs` | `scripts/learn-material-fixtures.mjs` | `.neura-learning/` boards and explicit snapshots. |
| `store:vault-events` | [learn-vault.ts#L9](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/neura/learn-vault.ts#L9) | [M13](https://github.com/Rajveerx11/neura/issues/127) | `partial` | `scripts/tests/learn-vault.mjs` | needed | Module-level evidence only; no v1 app test asserts vault events. |
| `store:checkpoints` | [checkpoint.ts#L126](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/checkpoint.ts#L126) | [M13](https://github.com/Rajveerx11/neura/issues/127) | `unavailable` | none | needed | OS-temp raw copies; never durable restart recovery. |
| `store:proof-suite-metadata` | [verification.ts#L184-L185](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/neura/verification.ts#L184-L185) | [M13](https://github.com/Rajveerx11/neura/issues/127) | `partial` | `tests/v1-verification.test.ts` | needed | `.proofofwork/neura-checks.json` is untrusted and cannot grant PASS. |
| `store:pi-session` | [check-gate.ts#L75](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/check-gate.ts#L75) | [M13](https://github.com/Rajveerx11/neura/issues/127) | `future` | none | needed | Pi journal, custom entries (mode, Plan, proof) and tree. v1 has its own new history store; legacy import is unresolved. |
| `store:context-sidecar` | [agent/settings.json#L13](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/settings.json#L13) | [M13](https://github.com/Rajveerx11/neura/issues/127) | `future` | none | needed | `@spences10/pi-context` SQLite; schema not audited. |
| `store:delegation-state` | [agent/settings.json#L8](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/settings.json#L8) | [M13](https://github.com/Rajveerx11/neura/issues/127) | `future` | none | needed | `pi-subagents` local state; format not audited. |
| `store:install-ownership` | [runtime-install.mjs#L14](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/neura/runtime-install.mjs#L14) | [M13](https://github.com/Rajveerx11/neura/issues/127) | `partial` | `tests/v1-install.test.ts` | needed | v1 replaces only a receipt-owned launcher and journals reversible retirement. Skill enablement and extension allowlist are not carried. |
| `store:herdr-october` | [usage-report.mjs#L22](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/integrations/herdr-usage/usage-report.mjs#L22) | [M13](https://github.com/Rajveerx11/neura/issues/127) | `future` | none | needed | Herdr cache and October service state. |

## External packages and native Pi facilities

Versions and integrity come from the baseline root `package-lock.json` and
`agent/settings.json`. Three configured packages have no lockfile entry at the baseline.

| ID | Baseline source | Owner | Status | Evidence | Fixture | Version and integrity |
|---|---|---|---|---|---|---|
| `pkg:@earendil-works/pi-coding-agent` | [package-lock.json#L485](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/package-lock.json#L485) | [M3](https://github.com/Rajveerx11/neura/issues/117) | `partial` | `tests/v1-runtime.test.ts` | `tests/model-fixture.ts` | `1.3.0`, `sha512-V/WoCjA2hQSe3QLWIUB24cTRdtEdeLiIzkDqU5RMXV6VWuD+KGZnzVBMhglwdnQTySkehZsjt8a3g6Jd2g4nnw==`. Removed; Mastra supplies the loop. |
| `pkg:@earendil-works/pi-ai` | [package-lock.json#L440](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/package-lock.json#L440) | [M4](https://github.com/Rajveerx11/neura/issues/118) | `partial` | `tests/v1-auth.test.ts` | `tests/model-fixture.ts` | `1.3.0`, `sha512-KaBI8x7q7sPoFUXICNGD9efHzDG+oRNwVvkA9jdIsSQWH1RjFssOlEGsbLtewUPPgCrvmz0l2KTgSLXTyj3acw==`. Removed; `src/providers.ts` replaces it. |
| `pkg:@earendil-works/pi-tui` | [package-lock.json#L700](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/package-lock.json#L700) | [M10](https://github.com/Rajveerx11/neura/issues/124) | `partial` | `tests/v1-terminal-ui.test.ts` | needed | `1.3.0`, `sha512-AlKvEwEWyVtnuw7SVb4N/mUhlfIohyFslUNWarZVdLHHSdt3ca5EhMLwTzblBpDpaofSz+f+tAHie6CfxVrWKA==`. Removed; Node readline replaces it without editor/IME parity. |
| `pkg:@ollama/pi-web-search` | [agent/settings.json#L5](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/settings.json#L5) | [M11](https://github.com/Rajveerx11/neura/issues/125) | `future` | none | needed | `0.0.5`; not in baseline lockfiles, integrity unknown. |
| `pkg:@spences10/pi-redact` | [agent/settings.json#L6](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/settings.json#L6) | [M11](https://github.com/Rajveerx11/neura/issues/125) | `partial` | `tests/v1-learn.test.ts` | needed | `0.0.14`, `sha512-Ey4rzVAuy+Q/xTeXw2iOIs2ES1N8m9hvvPFFESezRVs6u9gc99DN0q/bSSVvzuEt6CxGlQ6WVKsoNAmo29JRCw==` ([lock#L966](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/package-lock.json#L966), transitive dev entry). v1 uses Neura's own redaction; package behavior not ported. |
| `pkg:@spences10/pi-lsp` | [agent/settings.json#L7](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/settings.json#L7) | [M11](https://github.com/Rajveerx11/neura/issues/125) | `future` | none | needed | `0.0.44`; not in baseline lockfiles, integrity unknown. |
| `pkg:pi-subagents` | [agent/settings.json#L8](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/settings.json#L8) | [M11](https://github.com/Rajveerx11/neura/issues/125) | `future` | none | needed | `0.41.0`; not in baseline lockfiles, integrity unknown. The v1 reviewer is not delegation parity. |
| `pkg:@spences10/pi-mcp` | [agent/settings.json#L10](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/settings.json#L10) | [M11](https://github.com/Rajveerx11/neura/issues/125) | `unavailable` | none | needed | `0.0.58`, `sha512-IXQ58m8BpqCsrIduteXl2O09BS3t3B3WEkR34rhFohfefQD/kmUdShlThTGuOsI5gnWvBPF9IL6Wz5zNlAjchg==` ([lock#L932](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/package-lock.json#L932), direct dev dependency). |
| `pkg:@spences10/pi-context` | [agent/settings.json#L13](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/settings.json#L13) | [M11](https://github.com/Rajveerx11/neura/issues/125) | `future` | none | needed | `0.1.15`, `sha512-5AzO+qOfzVX+Cqpv6cBZzS7E9KGxdt9J+9lEMllatmf0PTADZd7r4lPAs64uUIH6Ez1FPjI2qcqPAjAxzItB5w==` ([lock#L902](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/package-lock.json#L902), transitive dev entry). |
| `native:codemode` | [guardrail.ts#L109](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/guardrail.ts#L109) | [M11](https://github.com/Rajveerx11/neura/issues/125) | `unavailable` | none | needed | Positive behavior was YOLO-only. |
| `native:tool_search` | [guardrail.ts#L109](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/guardrail.ts#L109) | [M11](https://github.com/Rajveerx11/neura/issues/125) | `unavailable` | none | needed | Dynamic activation and deferred calls; YOLO-only. |
| `native:context-sidecar` | [agent/settings.json#L13](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/settings.json#L13) | [M11](https://github.com/Rajveerx11/neura/issues/125) | `future` | none | needed | Context search/export through the sidecar. |
| `native:delegation` | [agent/settings.json#L8](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/settings.json#L8) | [M11](https://github.com/Rajveerx11/neura/issues/125) | `future` | none | needed | Subprocess delegation, ceilings and tool restrictions. |
| `native:provider-login-catalog` | [presets.ts#L25](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/presets.ts#L25) | [M4](https://github.com/Rajveerx11/neura/issues/118) | `partial` | `tests/v1-auth.test.ts` | `tests/model-fixture.ts` | Synthetic PKCE, refresh and catalog tests only. The owner's manual report is not a recorded test. Carried by [#118](https://github.com/Rajveerx11/neura/issues/118). |
| `native:session-tree-compaction-retries` | [learn.ts#L310](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/learn.ts#L310) | [M3](https://github.com/Rajveerx11/neura/issues/117) | `partial` | `tests/v1-runtime.test.ts` | `tests/model-fixture.ts` | v1 has linear create/list/append/resume history. No tree, fork, compaction or automatic retries. |
| `native:commands-resources` | [package-lock.json#L485](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/package-lock.json#L485) | [M3](https://github.com/Rajveerx11/neura/issues/117) | `partial` | `tests/v1-runtime.test.ts` | `tests/model-fixture.ts` | Native image parts exist. Resume/tree/fork commands, prompt templates, queued continuations and login/model/effort UI are not enumerated. |
| `native:extension-api` | [cockpit.ts#L260-L261](https://github.com/Rajveerx11/neura/blob/3ebaac07c8320125bcc32478b5aa3865746a997c/agent/extensions/cockpit.ts#L260-L261) | [M3](https://github.com/Rajveerx11/neura/issues/117) | `future` | none | needed | Lifecycle events from `session_start` to `session_shutdown`; v1 has no extension API. |

## Named gaps

These are open M0 items, not accepted limitations.

1. **Package catalogs.** Commands, UI, data formats and provider quirks of the six
   configured packages were not audited from published artifacts.
2. **Missing integrity.** `@ollama/pi-web-search`, `@spences10/pi-lsp` and
   `pi-subagents` have no baseline lockfile entry. `pi-redact` and `pi-context`
   integrity is a transitive dev entry, not proof of the settings-installed artifact.
3. **Native Pi command catalog.** Native commands, prompt-template and skill commands,
   and package commands other than `/mcp` are not enumerated.
4. **ExtensionAPI.** Only the events Neura consumes are listed in the migration
   reference's lifecycle table. Registries and the full API are not enumerated.
5. **Old-runtime fixtures and timing.** No synthetic old-runtime fixture or before/after
   timing input was captured ([#61](https://github.com/Rajveerx11/neura/issues/61)).
   Retained `scripts/tests/` Pi suites cannot run without the removed Pi packages.
6. **Positive cases.** No v1 positive case exists for Plan reads, YOLO controls or
   optional integrations.
7. **Subscription auth.** Evidence is synthetic. Real-account entitlement, refresh and
   restart are unverified ([#118](https://github.com/Rajveerx11/neura/issues/118)).
8. **Live WSL.** `tests/v1-work-sandbox.test.ts` needs a configured host and does not
   run in PR CI.
9. **Evidence depth.** Evidence paths were matched to rows by test name and imports,
   not assertion by assertion.
10. **Configuration and store completeness.** Categories follow the migration
    reference index. The check enforces only extension and command coverage.
11. **Herdr plugins.** `integrations/` plugins are retained without a v1 harness suite.

v1-only commands and settings (`/verify`, `/workflow`, `/review`, `/model`, `/login`,
`NEURA_HOME` and similar) are new surfaces, not baseline parity rows.

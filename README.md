# Neura

Neura is Rajveer's private engineering-agent harness built on
[`@earendil-works/pi-coding-agent`](https://pi.dev). It adds a focused terminal
interface, operating modes, verification, recovery, memory, model presets, and
guardrails around stock Pi.

Current version: **2.5.1**. Current `main` and the live harness use Pi
`0.84.4`. This remains a private, single-user engineering build and is
**not production-ready**. Human Away remains preview-labelled and is not
approved for unattended high-impact work. See
[current status](docs/STATUS.md), the
[production-readiness gate](docs/PRODUCTION_READINESS.md), and the historical
[2.5.1 release notes](docs/releases/v2.5.1.md).

## What is implemented

| Area | What it does | Main files |
|---|---|---|
| Identity | Logo-only launch, Neura persona, session-only Forged Tungsten theme | `agent/extensions/neura.ts`, `agent/neura/NEURA.md`, `agent/themes/neura-dark.json` |
| Modes | Plan, default WORK, YOLO, Human Away Preview, Shift+Tab switching, confirmed YOLO entry, persisted mode state | `agent/extensions/modes.ts`, `agent/neura/mode-state.ts` |
| Plan | Bounded web search, explicit request lifecycle, one structured HTML publisher under `plans/`, and a headless publication contract | `agent/extensions/plan-artifact.ts`, `agent/neura/plan-policy.ts`, `agent/neura/plan-renderer.ts` |
| Policy | Plan containment, supervised WORK mediation, state-bound approvals, centralized redaction, Gmail default-deny mediation, Human Away review queue, explicit YOLO bypass | `agent/extensions/guardrail.ts`, `agent/neura/action-policy.ts`, `agent/neura/approval-store.ts`, `agent/neura/redaction.ts` |
| Sandbox | WORK and Human Away WSL2 bubblewrap execution with workspace-only writable mount, cleared host environment, and no network namespace | `agent/extensions/human-away-sandbox.ts`, `agent/neura/human-away-sandbox.ts` |
| Recovery | In-memory Git worktree checkpoints and `/undo` | `agent/extensions/checkpoint.ts` |
| Verification | Quick proof-of-work feedback and full `/ship` command | `agent/extensions/check-gate.ts` |
| Cockpit | Responsive footer, active-operation state, notices, health panel, transcript copy | `agent/extensions/cockpit.ts`, `agent/extensions/harness-health.ts`, `agent/extensions/transcript-actions.ts` |
| Personal tools | Persistent local memory, model presets, skill compatibility scan | `agent/extensions/neura-memory.ts`, `agent/extensions/presets.ts`, `agent/extensions/skill-doctor.ts` |
| Integrations | MCP configuration for gfi-scout, Context7, Gmail, Paper, Supabase, and Notion | `agent/mcp.json` |

Exact maturity and known gaps live in [docs/STATUS.md](docs/STATUS.md). Do not
infer a security guarantee from a feature being present.

## Modes

| Mode | Intended use | Enforced behavior |
|---|---|---|
| Plan | Research and design before implementation | Activates bounded workspace reads and `web_search`; direct `web_fetch` stays disabled because its delegated backend does not expose DNS, connection-IP, or redirect-hop validation. Filesystem tools resolve inside the canonical workspace. Git inspection is limited to objects, refs, and index-only views under fixed process-blocking options; history disables mailmaps, unstaged diff requires explicit range-plus-separator syntax, and worktree-aware modes are denied. `plan_request` records waiting, revision, and separate-request transitions; only `publish_plan` may write, and only under the project `plans/` directory. |
| WORK | Default supervised engineering | Exposes structured workspace-contained reads and patches. Native shell accepts only hardened read-only inspection; `work_exec` runs tests, builds, and other local commands in WSL2 bubblewrap with only the active workspace writable, no host environment or user paths, and no network. Provider payloads expose only the active WORK tool set. Protected files, secret-shaped paths, remote mutation, destructive actions, and unknown tools fail closed or require one explicit interactive approval. |
| YOLO | Codex-style dangerous full access | Requires interactive confirmation when entered. Disables Neura application approvals and tool blocking. Native Windows provides no OS sandbox, so filesystem, network, and external tools inherit the signed-in user's permissions. After the logo-only splash, the footer keeps an explicit danger label visible. YOLO expands execution permission, not task scope. |
| Human Away Preview | Low-risk work while Rajveer is unavailable | Exposes only `human_away_exec`, backed by WSL2 bubblewrap. Windows drives and WSL home are hidden, the host environment is cleared, network is unshared, and only the active workspace is writable. Deterministic policy and the isolated reviewer still apply. |

Plan publication is supported in TUI, print, JSON, and RPC runs. Every active
request gets at most one automatic `publish_plan` retry. Waiting requests and
published requests do not retry. If the retry also settles without an artifact,
Neura appends a versioned `neura-plan-contract` session entry with
`status: "failed"` and `code: "PLAN_ARTIFACT_MISSING"`; JSON and RPC consumers
receive it as an `entry_appended` event. Successful publications append the same
contract entry with `status: "published"`, artifact identity, and hash.

New sessions start in WORK; a valid non-YOLO session mode is restored. Shift+Tab
cycles modes. `/mode plan|work|yolo|human-away` selects one directly. Every
transition into YOLO stops for explicit confirmation.
Ctrl+Shift+T owns Pi's thinking-level shortcut.

Migration needs no state rewrite: fresh sessions select WORK, saved Plan/WORK/Human
Away modes restore directly, and saved YOLO still asks for deliberate activation.
After merge, run `install.ps1` to update the generated live harness. Rollback by
reverting this change and reinstalling; an older harness treats a saved WORK entry
as unknown, asks before YOLO, and falls back to Plan when confirmation is denied.

## Install

Verified platform: Windows with PowerShell, Node.js/npm, Git, Pi `0.84.4`, and
`uvx`.

```powershell
npm install -g @earendil-works/pi-coding-agent@0.84.4
git clone https://github.com/Rajveerx11/neura.git C:\Neura
Set-Location C:\Neura
powershell -File .\install.ps1
pi update --extensions --approve
neura
```

`install.ps1` copies repository-controlled extensions, theme, policy modules,
MCP config, keybinding changes, and launcher into the live Pi harness. Existing
model and credential choices in `settings.json` are preserved unless
`-ForceSettings` is supplied.

Never store credentials in this repository. MCP credentials belong in Windows
user environment variables. Gmail requires `COMPOSIO_API_KEY`; other optional
servers remain disabled until configured.

## Verify

```powershell
npm ci --ignore-scripts
npm run typecheck
npm audit --audit-level=high
node scripts\verify-harness.mjs
node scripts\verify-sandbox.mjs
node scripts\check-docs.mjs
powershell -File .\install.ps1 -Check
```

- `verify-harness.mjs` loads all 16 extensions through Pi's real loader and
  exercises UI bounds, mode isolation, Plan publishing, filesystem containment,
  approvals, Gmail mediation, presets, recovery state, and guardrails.
- `check-docs.mjs` validates required release files, local Markdown links,
  version references, and stale launch claims.
- `verify-sandbox.mjs` exercises the live WSL2 bubblewrap mount, environment,
  network, system-write, redaction, and junction boundaries.
- `install.ps1 -Check` validates prerequisites and compares repository files
  with the live harness while ignoring line-ending-only differences.

## Commands

| Command | Purpose |
|---|---|
| `/mode [plan|work|yolo|human-away|next|status]` | Select or inspect operating mode |
| `/approvals` | Review Human Away requests |
| `/approvals audit` | Show recent approval decisions |
| `/health` | Inspect harness readiness and exact Pi-version drift |
| `/ship` | Run full proof-of-work verification |
| `/undo` | Restore the previous in-session checkpoint |
| `/undo list` | List available checkpoints |
| `/clip [answer|code]` | Copy the latest answer or a code block |
| `/preset gpt|opus|qwen` | Switch model preset |
| `/remember <fact>` | Save one local memory fact |
| `/memory` | Show local memory |
| `/skill-doctor` | Find skills that depend on Claude-only tools |
| `/dash` | Toggle the Neura wordmark |
| `/notices` | Show persistent degraded-state notices |

## Repository map

```text
agent/extensions/   Pi lifecycle hooks, commands, tools, and UI
agent/neura/        Shared policy, state, rendering, and reviewer modules
agent/themes/       Neura terminal theme
launcher/           Windows `neura` command
scripts/            Deterministic verification
docs/               Architecture, status, development, release, and history
plans/              Historical visual plans; not current requirements
```

## Documentation

- [Current feature and risk status](docs/STATUS.md)
- [Production-readiness gates and issue map](docs/PRODUCTION_READINESS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Development workflow](docs/DEVELOPMENT.md)
- [Dependency policy and review](docs/DEPENDENCIES.md)
- [Security policy](SECURITY.md)
- [Release process](docs/RELEASING.md)
- [Changelog](docs/CHANGELOG.md)
- [Design system](DESIGN.md)
- [Historical plan index](plans/README.md)
- [Contributing](CONTRIBUTING.md)

## License

Private, all rights reserved. See [LICENSE](LICENSE). No open-source license has
been granted.

# Neura

Neura is Rajveer's private engineering-agent harness built on
[`@earendil-works/pi-coding-agent`](https://pi.dev). It adds a focused terminal
interface, operating modes, verification, recovery, memory, model presets, and
guardrails around stock Pi.

Current version: **2.5.1-rc.1**. This is a private release candidate. Plan mode
is hardened for workspace-contained reads. Human Away remains a preview and is
not safe for unattended high-impact work. See [current status](docs/STATUS.md)
and [release notes](docs/releases/v2.5.1-rc.1.md).

## What is implemented

| Area | What it does | Main files |
|---|---|---|
| Identity | Logo-only launch, Neura persona, session-only Forged Tungsten theme | `agent/extensions/neura.ts`, `agent/neura/NEURA.md`, `agent/themes/neura-dark.json` |
| Modes | Plan, YOLO, Human Away Preview, Shift+Tab switching, persisted mode state | `agent/extensions/modes.ts`, `agent/neura/mode-state.ts` |
| Plan | Bounded research tools and one structured HTML publisher under `plans/` | `agent/extensions/plan-artifact.ts`, `agent/neura/plan-policy.ts`, `agent/neura/plan-renderer.ts` |
| Policy | Plan containment, Human Away action classification and review queue, explicit YOLO bypass | `agent/extensions/guardrail.ts`, `agent/neura/action-policy.ts`, `agent/neura/approval-store.ts` |
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
| Plan | Research and design before implementation | Activates bounded read/research tools. `read`, `grep`, `find`, and `ls` must resolve inside the canonical workspace. Only `publish_plan` may write, and only under the project `plans/` directory. |
| YOLO | Codex-style dangerous full access | Disables Neura application approvals and tool blocking. Native Windows provides no OS sandbox, so filesystem, network, and external tools inherit the signed-in user's permissions. YOLO expands execution permission, not task scope. |
| Human Away Preview | Low-risk work while Rajveer is unavailable | Uses deterministic policy plus an isolated no-tool reviewer. Deferred work enters a local approval queue. No OS sandbox exists, so this mode stays preview-only. |

Shift+Tab cycles modes. `/mode plan|yolo|human-away` selects one directly.
Ctrl+Shift+T owns Pi's thinking-level shortcut.

## Install

Verified platform: Windows with PowerShell, Node.js/npm, Git, Pi `0.83.0`, and
`uvx`.

```powershell
npm install -g @earendil-works/pi-coding-agent@0.83.0
git clone https://github.com/Rajveerx11/neura.git C:\Neura
Set-Location C:\Neura
powershell -File .\install.ps1
pi install
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
node scripts\verify-harness.mjs
node scripts\check-docs.mjs
powershell -File .\install.ps1 -Check
```

- `verify-harness.mjs` loads all 15 extensions through Pi's real loader and
  exercises UI bounds, mode isolation, Plan publishing, filesystem containment,
  approvals, Gmail mediation, presets, recovery state, and guardrails.
- `check-docs.mjs` validates required release files, local Markdown links,
  version references, and stale launch claims.
- `install.ps1 -Check` validates prerequisites and compares repository files
  with the live harness while ignoring line-ending-only differences.

## Commands

| Command | Purpose |
|---|---|
| `/mode [plan|yolo|human-away|next|status]` | Select or inspect operating mode |
| `/approvals` | Review Human Away requests |
| `/approvals audit` | Show recent approval decisions |
| `/health` | Inspect harness readiness |
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
- [Architecture](docs/ARCHITECTURE.md)
- [Development workflow](docs/DEVELOPMENT.md)
- [Security policy](SECURITY.md)
- [Release process](docs/RELEASING.md)
- [Changelog](docs/CHANGELOG.md)
- [Design system](DESIGN.md)
- [Historical plan index](plans/README.md)
- [Contributing](CONTRIBUTING.md)

## License

Private, all rights reserved. See [LICENSE](LICENSE). No open-source license has
been granted.

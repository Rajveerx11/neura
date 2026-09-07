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
| Modes | Plan, YOLO, Human Away Preview, Learn, Shift+Tab switching, confirmed YOLO entry, persisted mode state | `agent/extensions/modes.ts`, `agent/neura/mode-state.ts` |
| Learn | Visual workshops, PDF/PPTX references, offline English OCR, contained SQL practice, and optional local progress | `agent/extensions/learn.ts`, `agent/neura/learn-renderer.ts`, `agent/neura/learn-materials.ts` |
| Plan | Bounded web search, explicit request lifecycle, one structured HTML publisher under `plans/`, and a headless publication contract | `agent/extensions/plan-artifact.ts`, `agent/neura/plan-policy.ts`, `agent/neura/plan-renderer.ts` |
| Policy | Plan containment, state-bound approvals, centralized redaction, Gmail default-deny mediation, Human Away review queue, explicit YOLO bypass | `agent/extensions/guardrail.ts`, `agent/neura/action-policy.ts`, `agent/neura/approval-store.ts`, `agent/neura/redaction.ts` |
| Sandbox | Human Away WSL2 bubblewrap executor with workspace-only writable mount, cleared host environment, and no network namespace | `agent/extensions/human-away-sandbox.ts`, `agent/neura/human-away-sandbox.ts` |
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
| YOLO | Codex-style dangerous full access | Requires interactive confirmation when entered. Disables Neura application approvals and tool blocking. Native Windows provides no OS sandbox, so filesystem, network, and external tools inherit the signed-in user's permissions. After the logo-only splash, the footer keeps an explicit danger label visible. YOLO expands execution permission, not task scope. |
| Human Away Preview | Low-risk work while Rajveer is unavailable | Exposes only `human_away_exec`, backed by WSL2 bubblewrap. Windows drives and WSL home are hidden, the host environment is cleared, network is unshared, and only the active workspace is writable. Deterministic policy and the isolated reviewer still apply. |
| Learn | Practical learning with diagrams and short bullets | Bounded `read`/`ls`, web search, questions, and four dedicated learning tools. No generic shell, file edits, background proof, or remote mutations. Stock `grep`/`find` are excluded because host configuration can change their behavior. Local artifact writers and fixed exercise workers enforce separate limits. |

Plan publication is supported in TUI, print, JSON, and RPC runs. Every active
request gets at most one automatic `publish_plan` retry. Waiting requests and
published requests do not retry. If the retry also settles without an artifact,
Neura appends a versioned `neura-plan-contract` session entry with
`status: "failed"` and `code: "PLAN_ARTIFACT_MISSING"`; JSON and RPC consumers
receive it as an `entry_appended` event. Successful publications append the same
contract entry with `status: "published"`, artifact identity, and hash.

Shift+Tab cycles modes. `/mode plan|yolo|human-away|learn` selects one directly. Every
transition into YOLO stops for explicit confirmation.
Ctrl+Shift+T owns Pi's thinking-level shortcut.

## Learn Mode

Run `/mode learn`, give Neura a practical goal, and optionally name a PDF or PPTX
inside the current workspace. Open the returned local HTML board in your browser.
Lessons use flow/ER/sequence diagrams, 3-5 bullets, source excerpts, and practice.

- `/learn answer <text or SQL>` records an attempt; `/learn hint` and `/learn reveal` provide help.
- `/learn explain`, `/learn deeper`, and `/learn example` continue the active lesson.
- `/learn save` explicitly saves local progress; `/learn saved` lists snapshots;
  `/learn resume <filename>` restores one. Reimport originals to verify saved citations.
- Browser quizzes provide local feedback. Their copy controls hand answers to Neura;
  SQL runs only through the terminal tool. Browser actions do not silently sync progress.

PDFs include page previews and offline English OCR. PPTX supports slide text, notes,
and embedded raster images; export a deck to PDF for full-slide visuals. Legacy PPT
requires conversion. OCR and exact-match answers need human judgment; a passing
exercise is practice evidence, not proof of mastery.

Details, limits, and acceptance evidence: [Learn Mode](docs/LEARN_MODE.md).

## Install

Verified platform: Windows with PowerShell, Node.js 24.10+/npm, Git, Pi `0.84.4`, and
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
It also installs the locked Learn document runtime with lifecycle scripts disabled.

Never store credentials in this repository. MCP credentials belong in Windows
user environment variables. Gmail requires `COMPOSIO_API_KEY`; other optional
servers remain disabled until configured.

## Verify

```powershell
npm ci --ignore-scripts
npm ci --prefix agent/neura --ignore-scripts
npm run typecheck
npm audit --audit-level=high
node scripts\verify-harness.mjs
node scripts\verify-sandbox.mjs
node scripts\check-docs.mjs
npm run test:learn
powershell -File .\install.ps1 -Check
```

- `verify-harness.mjs` loads all 17 extensions through Pi's real loader and
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
| `/mode [plan|yolo|human-away|next|status]` | Select or inspect operating mode |
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

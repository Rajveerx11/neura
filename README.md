# Neura

Rajveer's personal engineering agent, built on top of [pi](https://pi.dev) (`@earendil-works/pi-coding-agent`).
This repo is the source of truth for the whole harness: extensions, theme, persona, launcher, config, and the visual plans that drove each phase.

Launch with `neura` in any terminal.

## What Neura adds on top of stock pi

| Piece | File | What it does |
|---|---|---|
| Identity + continuity | `agent/extensions/neura.ts` | Original six-line NEURA ASCII wordmark, compact fallback, width-aware resume ledger, notice count, `/dash`, and persona injection |
| Session modes | `agent/extensions/modes.ts` | Plan, YOLO, and Human Away modes; Shift+Tab cycling; `/mode`; animated transitions; read-only Plan tool boundary; Human Away return queue and `/approvals` |
| Mode policy core | `agent/neura/*.ts` | Shared mode state, deterministic action inspection, hash-chained approval audit, one-use exact retry grants, and isolated no-tool Headmaster reviewer |
| Cockpit shell | `agent/extensions/cockpit.ts` | One-line responsive mode/model/branch/context/cost footer plus a quiet below-editor rail for work, review, proof, recovery, and copy state |
| Transcript actions | `agent/extensions/transcript-actions.ts` | Uses Pi's clipboard API for `/clip` and Ctrl+Shift+X answer/code selection; preserves Markdown and copies raw fenced content without renderer patches |
| Harness health | `agent/extensions/harness-health.ts` | `/health` readiness console for runtime tools, checkpoints, proof gate, memory, skills, git state, MCP bridges, and local Qwen |
| Guardrails | `agent/extensions/guardrail.ts` | Mode-aware complete tool-call mediation: Plan blocks mutation, YOLO asks for sensitive actions, and Human Away clamps Headmaster verdicts through deterministic policy before exact execution or queueing |
| Report format | `agent/extensions/ship-report.ts` | Injects the end-of-iteration report format (What / Why / Do now / Takeaway) into every turn |
| Model presets | `agent/extensions/presets.ts` | `/preset gpt` (Codex, included in the ChatGPT sub) ↔ `/preset opus` (Claude Opus 5, billed as Claude extra usage) ↔ `/preset qwen` (local llama.cpp Qwen3-Coder-30B at `127.0.0.1:8080/v1`) |
| Memory | `agent/extensions/neura-memory.ts` | Cross-session memory: `~/.pi/agent/neura/MEMORY.md` injected every turn; `/remember <fact>`, `/memory`; agent updates its own memory file (MEMORY.md itself is gitignored) |
| Checkpoints | `agent/extensions/checkpoint.ts` | Silent worktree snapshot (git plumbing, throwaway index) before every agent run; `/undo` restores, `/undo list` inspects; /undo itself is reversible |
| Check gate | `agent/extensions/check-gate.ts` | Self-verification via [proof-of-work](https://github.com/Rajveerx11/proof-of-work): quick tamper scan (`--no-tests`) after every turn that changed the working tree, failures fed back to the agent (1 retry cap); `/ship` runs the full check — real tests + signed audit-log verdict |
| Skill doctor | `agent/extensions/skill-doctor.ts` | `/skill-doctor` scans skill dirs for Claude-only tool references that won't work in pi |
| Autogit | `agent/extensions/autogit.ts` | Auto stage→commit→push after YOLO turns; disabled in Plan and held in the Human Away queue because `agent_end` runs outside `tool_call` mediation |
| Theme | `agent/themes/neura-dark.json` | Forged Tungsten: tungsten neutrals, burnt copper `#d97841`, bone text, semantic outcome colors |
| MCP bridge | `agent/mcp.json` | 5 servers via `@spences10/pi-mcp`: gfi-scout · paper · Context7 · Supabase (read-only) · Notion. Tokens flow through `MY_PI_MCP_ENV_ALLOWLIST` user env vars — never in the file |
| Persona | `agent/neura/NEURA.md` | Names the agent Neura, terse root-cause engineering style, **no emojis ever** |
| Launcher | `launcher/neura.cmd` | `neura` command (goes in `~/.local/bin`, on PATH) |
| Config | `agent/settings.json` | gpt-5.5 default, neura-dark theme, packages, skills pointed at `~/.claude/skills` |

## Skills & packages

- **Skills**: pi reads Claude Code's skill format natively — `settings.json` points at `~/.claude/skills`, one source of truth for both agents. Skills themselves are NOT in this repo.
- **Packages** (installed via `pi install`, declared in settings): `@spences10/pi-redact` (secret scrubbing before model sees output), `@spences10/pi-lsp` (language-server diagnostics), `pi-subagents` (fan-out subagents), `@ollama/pi-web-search`.
- All third-party packages were source-vetted before install: no install scripts, no telemetry, no network exfil.

## Restore on a fresh machine

```powershell
npm install -g @earendil-works/pi-coding-agent
git clone <this repo> C:\Neura
powershell -File C:\Neura\install.ps1
```

`install.ps1` copies `agent/*` into `~/.pi/agent/` and the launcher into `~/.local/bin`. Use `install.ps1 -Check` to detect missing prerequisites or drift between this repo and the live harness.

## Verify changes

```powershell
node scripts/verify-harness.mjs
powershell -File .\install.ps1 -Check
```

The Node verifier loads every TypeScript extension through Pi's real loader and tests both ASCII wordmarks, five responsive widths, cockpit and footer bounds, transcript copy discovery, capability-latch animation, mode isolation, approval evidence, one-use retries, circuit breaking, `/health`, presets, and guardrails.

## Execution modes

Shift+Tab cycles `PLAN → YOLO → HUMAN AWAY`. `/mode` opens the selector; `/mode plan|yolo|human-away` switches directly. Pi's thinking-level shortcut moves to Ctrl+Shift+T so Shift+Tab has one unambiguous owner.

- **Plan** — fixed read-only tool set. Shell is limited to exact inspection commands. Mutations are blocked even when requested by the model.
- **YOLO** — autonomous workspace work. Existing sensitive boundaries still ask Rajveer; YOLO is not a guardrail bypass.
- **Human Away (preview)** — routine workspace work continues. Reviewable actions go to a separate ephemeral Pi process with no tools, extensions, skills, context files, or session. Deterministic policy can auto-approve only one generated, untracked workspace file. Secrets, control-plane edits, remote mutation, opaque shell, and unaudited custom tools wait for Rajveer.

Human Away approvals are exact-action, exact-workspace-state, one-use grants that expire after 120 seconds. Deferred work is stored in a sanitized SHA-256 hash-chained JSONL audit under `~/.pi/agent/neura/approvals/`. The first interactive input after returning surfaces the queue; `/approvals` reviews it. Approval asks the main agent to retry and never replays a stale command directly.

## Security rules

- No secrets in this repo, ever. Tokens live in user environment variables.
- `auth.json`, `models.json`, session files are deliberately NOT tracked.
- Vet any new pi package source before `pi install` (check: no postinstall scripts, no unknown network calls, explainable exec).
- Headmaster is a reviewer, not a permission source. Deterministic policy always clamps its verdict.
- Human Away is an opt-in preview on native Windows. Neura still lacks an OS-enforced workspace sandbox, so do not treat it as safe for truly unattended high-impact work.
- Human Away suppresses autogit shipping and October transcript export; protected side effects wait for human return.

## Operator commands

- `/health` checks the complete agentic harness; `/health close` hides the panel.
- `/mode [plan|yolo|human-away|next|status]` selects or inspects the execution mode. Shift+Tab cycles modes.
- `/approvals` opens pending Human Away work; `/approvals audit` shows recent decisions; `approve|deny|dismiss <id>` handles one record.
- `/clip [answer|code]` copies the latest answer or chooses a fenced code block; Ctrl+Shift+X opens the same chooser.
- `/notices` opens persistent degraded-state details; `/notices close` hides the panel.
- `/dash` toggles the continuity launch.
- `/ship` runs the full proof-of-work gate.
- `/undo` restores the checkpoint from before the last agent run.
- `/preset gpt|opus|qwen` changes the execution model. `opus` needs `/login anthropic` once (Claude Pro/Max); pi bills third-party harness usage as Claude **extra usage**, per token, not against plan limits.

## Roadmap

- **Done (2026-07-21)**: Phase 1 (skills unification), packages, guardrails, cockpit v1 (Neura identity, dashboard, footer, theme, launcher)
- **Done (2026-07-22)**: Phase 2 Part A — MCP bridge (`@spences10/pi-mcp` + `agent/mcp.json`). Context7/Supabase/Notion reach full power once their tokens are set as user env vars. Hosted plan server dropped — visual plans are always local HTML, never the hosted service.
- **Done (2026-07-28)**: Forged Tungsten design system and Continuity Spine launch.
- **Done (2026-07-31)**: `/preset opus` — Neura can run Claude Opus 5 for the hard 5% instead of being locked to one brain.
- **Done (2026-08-02)**: Modes v1 — Plan, YOLO, Human Away preview, Headmaster delegated review, exact approval queue, animated Shift+Tab transitions, and side-effect mediation.
- **Done (2026-08-02)**: Cockpit redesign — restored ASCII identity, capability-latch mode motion, agent-focused approvals, shared operation/proof/recovery state, responsive footer, transcript copy actions, and accessible semantic theme tokens.
- **Next**: OS-enforced Windows/WSL sandbox and adversarial replay suite before removing the Human Away preview warning; then run scorecard and per-tool color badges.

Plans for each phase are in `plans/` (self-contained HTML, open in any browser). Change history in `docs/CHANGELOG.md`.

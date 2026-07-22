# Neura

Rajveer's personal engineering agent, built on top of [pi](https://pi.dev) (`@earendil-works/pi-coding-agent`).
This repo is the source of truth for the whole harness: extensions, theme, persona, launcher, config, and the visual plans that drove each phase.

Launch with `neura` in any terminal.

## What Neura adds on top of stock pi

| Piece | File | What it does |
|---|---|---|
| Identity + dashboard | `agent/extensions/neura.ts` | ASCII logo + time-aware greeting on launch; automatic 3-column dashboard (today's todos from Obsidian daily note · recent projects from pi's session store · week goals from learn-day profile + open checkboxes); `/dash` toggle; injects `NEURA.md` persona every turn |
| Cockpit footer | `agent/extensions/cockpit.ts` | Minimal 4-field footer: model · git branch · ctx% · cost, tight gaps; extension statuses appear as a second line only when active |
| Guardrails | `agent/extensions/guardrail.ts` | Block-and-ask on destructive commands (rm -rf, force-push, DROP TABLE, Remove-Item -Recurse -Force, disk format) and secret-file access (.env, keys, credentials) — pi ships with no permission system, this is it |
| Report format | `agent/extensions/ship-report.ts` | Injects the end-of-iteration report format (What / Why / Do now / Takeaway) into every turn |
| Model presets | `agent/extensions/presets.ts` | `/preset gpt` ↔ `/preset qwen`; registers local llama.cpp (Qwen3-Coder-30B) as a provider at `127.0.0.1:8080/v1` |
| Check gate | `agent/extensions/check-gate.ts` | Self-verification via [proof-of-work](https://github.com/Rajveerx11/proof-of-work): quick tamper scan (`--no-tests`) after every turn that changed the working tree, failures fed back to the agent (1 retry cap); `/ship` runs the full check — real tests + signed audit-log verdict |
| Skill doctor | `agent/extensions/skill-doctor.ts` | `/skill-doctor` scans skill dirs for Claude-only tool references that won't work in pi |
| Autogit | `agent/extensions/autogit.ts` | Pre-existing: auto stage→commit→push after agent turns (needs `autogit` on PATH) |
| Theme | `agent/themes/neura-dark.json` | Near-black theme, jade accent `#3d8f7a`, all 51 tokens |
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

`install.ps1` copies `agent/*` into `~/.pi/agent/` and the launcher into `~/.local/bin`.

## Security rules

- No secrets in this repo, ever. Tokens live in user environment variables.
- `auth.json`, `models.json`, session files are deliberately NOT tracked.
- Vet any new pi package source before `pi install` (check: no postinstall scripts, no unknown network calls, explainable exec).

## Roadmap

- **Done (2026-07-21)**: Phase 1 (skills unification), packages, guardrails, cockpit v1 (Neura identity, dashboard, footer, theme, launcher)
- **Done (2026-07-22)**: Phase 2 Part A — MCP bridge (`@spences10/pi-mcp` + `agent/mcp.json`). Context7/Supabase/Notion reach full power once their tokens are set as user env vars. Hosted plan server dropped — visual plans are always local HTML, never the hosted service.
- **v1.1**: per-tool color badges (needs built-in tool override), width-aware dashboard columns.

Plans for each phase are in `plans/` (self-contained HTML, open in any browser). Change history in `docs/CHANGELOG.md`.

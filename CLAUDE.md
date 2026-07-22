# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Source of truth for **Neura** — Rajveer's personal agent layer on top of [pi](https://pi.dev) (`@earendil-works/pi-coding-agent`). The repo holds extensions, theme, persona, launcher, and config; the **live install** is `~/.pi/agent/` (extensions, themes, neura/, settings.json) plus `~/.local/bin/neura.cmd`. pi loads the live copies, not this repo.

## Development workflow

There is no build, lint, or test tooling. Extensions are TypeScript files pi loads directly.

The edit loop:
1. Edit the live file in `C:\Users\rajve\.pi\agent\extensions\` (or themes/, neura/).
2. Verify (see below).
3. Copy the changed file into the matching path under `C:\Neura\agent\`, commit, push.

Fresh-machine restore is `install.ps1` (copies `agent/*` → `~/.pi/agent/`, launcher → `~/.local/bin`; never clobbers an existing settings.json).

### Verification commands

```powershell
pi -p "What is your name? One word."                    # expect "Pi" — stock pi must stay stock
$env:NEURA="1"; pi -p "What is your name? One word."    # expect "Neura"
neura                                                    # fresh terminal: logo + greeting + 3-column dashboard
```

Dashboard must show no "(widget truncated)" and no UUID/temp entries under Projects.

## Architecture

### The NEURA gate (the one invariant)

Every custom extension begins with `if (!process.env.NEURA) return;`. `neura.cmd` sets that env var; plain `pi` gets the stock agent — default theme, no persona, no widgets, no guardrails. Any new extension must gate the same way. The theme is applied session-only via `ctx.ui.setTheme(themeInstance)` in `session_start` — **never persist theme to settings.json**, that would leak Neura's theme into plain pi.

### pi extension model

An extension is a default-exported `function (pi)` in `agent/extensions/`. Relevant surface used here:
- Events: `session_start`, `agent_start`, `before_agent_start` (return `{ systemPrompt }` to modify the prompt — this is how `NEURA.md` persona and the ship-report format get injected every turn)
- `ctx.ui.setWidget(id, lines | undefined)` — pi caps each widget at **10 lines** (`MAX_WIDGET_LINES`); that's why logo and dashboard are two separate widgets (`neura-logo`, `neura-dash`)
- `pi.registerCommand(name, { description, handler })`

### Extensions

| File | Role |
|---|---|
| `neura.ts` | Logo, greeting, 3-column dashboard (Obsidian daily-note todos · pi session-store projects · learn-day week goals · Google Calendar), `/dash` toggle, persona injection |
| `cockpit.ts` | 4-field footer: model · git branch · ctx% meter · cost, with color ramps |
| `guardrail.ts` | Block-and-ask on destructive commands and secret-file reads — pi has no permission system; this is it. Don't weaken it |
| `ship-report.ts` | Injects end-of-iteration report format into every turn |
| `presets.ts` | `/preset gpt\|qwen`; registers local llama.cpp (Qwen3-Coder-30B) provider at `127.0.0.1:8080/v1` |
| `skill-doctor.ts` | `/skill-doctor` flags skills using Claude-only tools |
| `autogit.ts`, `october-bus.ts` | Pre-existing, not Neura-specific |

### Data sources (all fail-soft)

Every dashboard data source is wrapped in try/catch and degrades to empty — a missing vault, profile, or env var must never break launch:
- Obsidian daily notes: `C:/Users/rajve/OneDrive/Documents/Obsidian Vault`, filename `DD-MM-YY(Ddd).md`
- Week goals: `~/.claude/skills/learn-day/data/profile.md` + open checkboxes from the week's notes
- Projects: `~/.pi/agent/sessions/` dir names, junk filtered by `JUNK_PROJECT` regex
- Calendar: secret iCal URL in env var `NEURA_GCAL_ICS` (fetched async, 4s timeout; falls back to tomorrow's events with `tmrw` prefix when today is empty). RRULE recurring events are deliberately not expanded

### MCP bridge

`agent/mcp.json` (live copy `~/.pi/agent/mcp.json`) defines servers loaded by `@spences10/pi-mcp`. Rules learned the hard way:
- pi-mcp does **not** expand `${VAR}` in stdio `env` blocks (only in HTTP headers). Tokens reach servers via the user env var `MY_PI_MCP_ENV_ALLOWLIST` (ambient pass-through) — never write tokens or `${VAR}` placeholders into mcp.json.
- npx-based servers must be spawned as `"command": "cmd", "args": ["/c", "npx", ...]` — pi-mcp spawns without a shell and `.cmd` shims fail on modern Node.
- Servers connect lazily (`/mcp connect <server>`); startup stays quiet even when a server's token is missing or its app (paper) isn't running.

### Skills and packages

pi reads Claude Code skills natively — `settings.json` has `"skills": ["~/.claude/skills"]`, one source of truth for both agents. Skills are NOT in this repo. Packages (`pi-redact`, `pi-lsp`, `pi-subagents`, `pi-web-search`) are declared in settings and installed via `pi install`; vet any new package's source first (no postinstall scripts, no unexplained network/exec).

## Hard constraints

- **No emojis, ever** — anywhere in Neura output, widgets, or persona. Geometric/box symbols only.
- **No blue or saffron accents.** Palette is muted jade `#3d8f7a`, mint `#7fc4ae`, slate — theme file `agent/themes/neura-dark.json`.
- **No secrets in this repo.** Tokens live in user env vars; `auth.json`, `models.json`, session files are deliberately untracked.
- Dashboard columns are fixed 34 chars; cell text hard-truncates (`fit()`) so entries never bleed across columns.
- No Devanagari in terminal output — Windows Terminal cannot shape conjuncts (why the shloka feature was removed).

`docs/CHANGELOG.md` records the rationale behind each version; check it before re-attempting something previously removed or deferred.

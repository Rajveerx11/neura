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
node scripts/verify-harness.mjs                           # extension load + responsive UI + safety tests
powershell -File .\install.ps1 -Check                    # prerequisites + repo/live drift
pi --no-session --no-context-files -p "What is your name? One word."                 # expect "Pi"
$env:NEURA="1"; pi --no-session --no-context-files -p "What is your name? One word." # expect "Neura"
neura                                                    # fresh terminal: continuity launch
```

Launch must show no "(widget truncated)" and no UUID/temp entries under LAST.

## Architecture

### The NEURA gate (the one invariant)

Every custom extension begins with `if (!process.env.NEURA) return;`. `neura.cmd` sets that env var; plain `pi` gets the stock agent — default theme, no persona, no widgets, no guardrails. Any new extension must gate the same way. The theme is applied session-only via `ctx.ui.setTheme(themeInstance)` in `session_start` — **never persist theme to settings.json**, that would leak Neura's theme into plain pi.

### pi extension model

An extension is a default-exported `function (pi)` in `agent/extensions/`. Relevant surface used here:
- Events: `session_start`, `agent_start`, `agent_settled` (fires only when pi will not auto-continue — use it, not `agent_end`, for post-turn work), `before_agent_start` (return `{ systemPrompt }` to append — persona, ship-report format, and memory all inject this way), `input` (`event.source` distinguishes interactive vs extension-injected messages)
- `ctx.ui.setWidget(id, lines | undefined)` — pi caps each widget at **10 lines** (`MAX_WIDGET_LINES`); that's why logo and dashboard are two separate widgets (`neura-logo`, `neura-dash`)
- `pi.registerCommand(name, { description, handler })`; `pi.registerTool(...)` adds a schema-validated model tool; `pi.sendUserMessage(text, {deliverAs:"followUp"})` queues work back to the agent
- Full API reference: `docs/extensions.md` inside the globally installed `@earendil-works/pi-coding-agent` package

Hard-won platform rules:
- **Print mode (`pi -p`) tears down before async handlers finish and never processes follow-ups.** Anything depending on `agent_settled` + follow-up must gate on `ctx.hasUI`; wrap late `ctx` uses in try/catch (stale-ctx throws after session replacement).
- **Windows spawn**: `.ps1`/`.cmd` shims (npm CLIs, npx) cannot be spawned directly — route through `cmd /c`. `.exe` on PATH is fine.
- **Detect "did the agent change files" by fingerprinting the git tree, not by watching tool names** — the agent can edit through `bash` and bypass any tool-name list.

### Extensions

| File | Role |
|---|---|
| `neura.ts` | Forged Tungsten continuity launch: greeting, LAST/NOW/NEXT session spine, `/dash` toggle, persona injection |
| `check-gate.ts` | Self-verification: after any agent run that changed the worktree, runs `uvx --from proof-of-work-agent proof-of-work check --no-tests --json --base HEAD`; failures fed back via `pi.sendUserMessage(..., {deliverAs:"followUp"})`, capped at 1 auto-retry per user prompt. `/ship` = full check (real tests, signed audit log). Dirty detection is a git tree fingerprint (`status --porcelain` + `diff HEAD` hashed) compared between `agent_start` and `agent_settled` — never tool names |
| `checkpoint.ts` | Worktree snapshot before every agent run via throwaway `GIT_INDEX_FILE` + `write-tree`; `/undo` restores (itself reversible), `/undo list`. Never `add --force` (would snapshot node_modules); never deletes files created after a snapshot |
| `neura-memory.ts` | Cross-session memory: `~/.pi/agent/neura/MEMORY.md` injected every turn; `/remember`, `/memory`; agent is told the path so it maintains its own memory. MEMORY.md is gitignored (personal data) |
| `cockpit.ts` | Responsive footer: model · git branch · ctx% meter · cost; fields collapse before overflow; live extension operations use the second line |
| `harness-health.ts` | `/health` readiness console: runtime tools, checkpoint/proof gate, memory, skills, git state, MCP bridges, and local Qwen |
| `guardrail.ts` | Block-and-ask on destructive commands and secret-file reads — pi has no permission system; this is it. Don't weaken it |
| `modes.ts`, `plan-artifact.ts` | Plan mode research contract and its only write seam. `publish_plan` renders structured data into safe local HTML under `plans/`; generic writes stay disabled |
| `ship-report.ts` | Injects end-of-iteration report format into every turn |
| `presets.ts` | `/preset gpt\|qwen`; registers local llama.cpp (Qwen3-Coder-30B) provider at `127.0.0.1:8080/v1` |
| `skill-doctor.ts` | `/skill-doctor` flags skills using Claude-only tools |
| `autogit.ts`, `october-bus.ts` | Pre-existing, not Neura-specific. autogit spawns through `cmd /c` (npm ships it as `.ps1`/`.cmd` shims) |

### Launch continuity source

The launch reads only local pi session-directory names and timestamps, filtered
by `JUNK_PROJECT`. It does not parse transcript contents. Git branch and dirty
state come from the current workspace. Every read fails soft.

### MCP bridge

`agent/mcp.json` (live copy `~/.pi/agent/mcp.json`) defines servers loaded by `@spences10/pi-mcp`. Rules learned the hard way:
- pi-mcp does **not** expand `${VAR}` in stdio `env` blocks (only in HTTP headers). Tokens reach servers via the user env var `MY_PI_MCP_ENV_ALLOWLIST` (ambient pass-through) — never write tokens or `${VAR}` placeholders into mcp.json.
- npx-based servers must be spawned as `"command": "cmd", "args": ["/c", "npx", ...]` — pi-mcp spawns without a shell and `.cmd` shims fail on modern Node.
- A server that can't currently connect (missing token, companion app closed) gets `"disabled": true` in mcp.json instead of failing at startup; re-enable with `/mcp enable <server>`. paper, supabase, and notion ship disabled for exactly this reason.
- CONTEXT7_API_KEY is set as a user env var (flows via MY_PI_MCP_ENV_ALLOWLIST). SUPABASE_ACCESS_TOKEN / NOTION_TOKEN deliberately unset — user skipped both; their servers stay disabled.

### Skills and packages

pi reads Claude Code skills natively — `settings.json` has `"skills": ["~/.claude/skills"]`, one source of truth for both agents. Skills are NOT in this repo. Packages (`pi-redact`, `pi-lsp`, `pi-subagents`, `pi-web-search`, `pi-mcp`, `pi-context`) are declared in settings and installed via `pi install`; vet any new package's source first (no postinstall scripts, no unexplained network/exec — download the npm tarball and grep dist for `fetch(`/`child_process`/`eval(`).

check-gate's engine is the user's own [proof-of-work](https://github.com/Rajveerx11/proof-of-work) (PyPI: `proof-of-work-agent`), run via `uvx` — Python 3.11+ and uv are on the machine; nothing to install. Gaps found in it should be fixed in that repo, not worked around here.

## Hard constraints

- **No emojis, ever** — anywhere in Neura output, widgets, or persona. Geometric/box symbols only.
- **Forged Tungsten only:** canvas `#0b0c0e`, surface `#14171a`, raised `#1c2024`, copper `#d97841`, bone `#e8e2d8`, muted steel `#a8a39b`. Copper is the sole brand accent. Semantic green/amber/red are outcomes only.
- **No secrets in this repo.** Tokens live in user env vars; `auth.json`, `models.json`, session files, and `MEMORY.md` are deliberately untracked.
- No decorative gradients, colored glow, or ambient color noise.
- Launch is width-aware LAST/NOW/NEXT continuity, not a dashboard wall. Every widget stays within pi's 10-line cap and ANSI-aware truncation prevents bleed. Junk-filter project names before truncating them.
- No Devanagari in terminal output — Windows Terminal cannot shape conjuncts (why the shloka feature was removed).

`docs/CHANGELOG.md` records the rationale behind each version; check it before re-attempting something previously removed or deferred.

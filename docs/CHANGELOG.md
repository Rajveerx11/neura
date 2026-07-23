# Changelog

## 2026-07-23 — v1.7 (Phase 3B: /undo checkpoints + error fixes + launch polish)

- **`checkpoint.ts` (Phase 3B)** — silent worktree snapshot before every agent run via git plumbing (throwaway `GIT_INDEX_FILE` + `write-tree`; no stash entries, worktree untouched). `/undo` restores the last snapshot (state before /undo is itself snapshotted, so /undo is reversible); `/undo list` shows the session's snapshots. Plumbing verified end-to-end in a scratch repo, incl. restoring a deleted file. Deliberate limits: `.gitignore`d files excluded (`--force` would drag node_modules into git objects), files created after a snapshot are left in place (never auto-delete untracked work), in-memory only.
- **autogit "not found on PATH" fixed** — npm installs autogit as `.ps1`/`.cmd` shims; Windows `spawn("autogit")` needs `cmd /c`. Also mutes to a single notice per session when autogit genuinely isn't installed (was two red errors every turn).
- **MCP startup warnings silenced** — paper (app rarely running) and supabase (token not set) marked `"disabled": true` in mcp.json; re-enable with `/mcp enable paper` / `/mcp enable supabase` when ready.
- **Packages updated** via `pi update --extensions` (pi-lsp, pi-mcp).
- **Launch polish**: logo gets a vertical violet→rose gradient (truecolor lerp), greeting line shows the date, dashboard headers get a dim hairline rule with `┼` crosses aligned to the column separators.

## 2026-07-22 — v1.6.1 (dashboard redesign + palette v4 "orchid dusk")

- **Palette v4**: jade/mint dropped (third rejected palette: blue, saffron, jade). New "orchid dusk" — violet `#a583d9` accent, rose `#d495b5` secondary, ivory text `#e5e0e6`, plum-gray neutrals. Chosen from 4 candidates rendered live as terminal swatches. Applied across neura.ts, cockpit.ts, and all decorative theme tokens; semantic colors (diff green/red, warning amber, error red) kept.
- **Dashboard layout**: dim `│` separators between columns; every list entry is a bullet (`•` in the column's accent color); calendar events show name only (times dropped, still sorted chronologically, `tmrw` prefix stays); project entries show name only ("Xw ago" dropped); columns 34 → 32 chars (same total width with separators).
- **Junk-filter bug fixed**: filter ran on the truncated name, so `Test-.claude-worktre` (cut before "worktrees" completed) slipped through. Filter now runs on the full name, plus `worktre` and `\.claude` patterns.

## 2026-07-22 — v1.6 (Phase 3A: self-verification via proof-of-work)

- **`check-gate.ts`** — Neura now verifies its own work with Rajveer's own [proof-of-work](https://github.com/Rajveerx11/proof-of-work) (`uvx --from proof-of-work-agent`, zero install, Python 3.11 + uv confirmed on machine).
  - Quick gate: after every agent run that changed the working tree, `proof-of-work check --no-tests --json --base HEAD` runs; on FAIL the block/warn reasons are fed back via `pi.sendUserMessage(..., {deliverAs:"followUp"})` so the agent fixes itself — capped at 1 auto-retry per user prompt.
  - `/ship`: full check (real test re-run, coverage, verdict signed into the hash-chained audit log).
  - **Dirty detection is tree-fingerprint, not tool-name**: sha1 of `git status --porcelain` + `git diff HEAD` compared between `agent_start` and `agent_settled`. First attempt watched `edit`/`write` tool calls and missed the agent appending via `bash` — snapshot compare catches every mutation path.
  - Verified: `--base HEAD` sees **unstaged** worktree changes (caught a planted `sys.exit(0)` fake-pass as BLOCK in the scratch-repo test).
  - Gated `ctx.hasUI`: print mode (`pi -p`) tears down before async handlers finish and never processes follow-ups — gate is interactive-only; late `ctx` uses wrapped so a mid-check session switch can't crash the harness.
- Supermemory evaluated for Phase 3C memory: deferred — service+database is too heavy for the fact-file need, but it ships an MCP server, so it can drop into `mcp.json` later with zero code if deep semantic recall becomes real.

## 2026-07-22 — v1.5.1

- **Hosted plan server removed from mcp.json** — its OAuth serves plan.agent-native.com (hosted visual plans); Rajveer's visual plans are always local HTML files opened in Zen, so the server has no use. Down to 5 servers.

## 2026-07-22 — v1.5 (Phase 2 Part A: MCP bridge)

- **`@spences10/pi-mcp@0.0.53` installed** (source-vetted: no lifecycle scripts, spawn/fetch only for configured servers, restricted child env via `pi-child-env`).
- **`agent/mcp.json`** — 6 servers: gfi-scout, paper (localhost HTTP), plan (hosted, OAuth pending), context7, supabase (`--read-only`), notion. Zero secrets in the file.
- **Token pass-through via allowlist, not `${VAR}`**: pi-mcp does NOT expand `${VAR}` in stdio `env` blocks (only HTTP headers). Instead `MY_PI_MCP_ENV_ALLOWLIST=GITHUB_TOKEN,CONTEXT7_API_KEY,SUPABASE_ACCESS_TOKEN,NOTION_TOKEN` (user env var) passes ambient tokens to servers that read their own env.
- **npx servers wrapped as `cmd /c npx ...`** — pi-mcp spawns without `shell:true`; `.cmd` shims fail on modern Node (EINVAL).
- **`GITHUB_TOKEN` moved to user env var** (from `.claude.json` plaintext — rotation still pending, old copy still in `.claude.json` until rotated).
- Verified headless with eager connect: gfi-scout 4 tools, context7 2 tools (keyless mode), notion 28 tools registered. Supabase/paper/plan pending token / app running / OAuth. Default stays lazy connect — no startup noise.

## 2026-07-21 — v1.4

- **Fixed "(widget truncated)"**: pi caps each widget at 10 lines (`MAX_WIDGET_LINES`); logo+greeting+dashboard in one widget exceeded it. Split into two widgets (`neura-logo`, `neura-dash`), each within budget.
- **Shloka feature removed**: Windows Terminal's cell-grid renderer breaks Devanagari conjuncts (रक्षितः → र क्ष ति) — complex-script shaping is a terminal limitation, unfixable from pi. Verses live on in git history if a GUI surface ever wants them.

## 2026-07-21 — Cockpit v1.2

- **pi/neura split**: all Neura extensions gate on `NEURA` env var; `neura.cmd` sets it. Plain `pi` = stock agent (default theme, no persona/widgets/guardrails); `neura` = full custom. Theme applied session-only via `ctx.ui.setTheme(instance)` — never persisted to settings. Verified: `pi` answers "Pi", `neura` answers "Neura".
- **Shlokas v2**: replaced with ~50 SHORT one-liner verses; compact 2-line display `॥ verse ॥` + `meaning — source`; grapheme-cluster width calc (Intl.Segmenter) fixes ragged Devanagari alignment.
- **Palette v3**: saffron dropped from UI — muted jade `#3d8f7a` accent, mint `#7fc4ae`, slate, warm-neutral darks. Saffron `#e8a34a` reserved exclusively for the shloka.
- **Font**: Windows Terminal defaults set to `Cascadia Code, Nirmala Text` (Devanagari fallback); backup at `settings.json.bak-neura`.

## 2026-07-21 — Cockpit v1.1 (rev 4)

- **Palette**: blue dropped; saffron-gold scheme — accent `#e8a34a`, sand `#f2c98a`, teal `#4db8a8`, warm near-black backgrounds. Theme + all extensions recolored.
- **Footer v2** (`cockpit.ts`): left-aligned tight gaps, saffron model mark `▊`, context meter `▰▰▰▱▱▱▱▱ 41%` with color ramp (>60% amber, >85% red), cost color ramp (>$2 amber, >$10 red).
- **Sanskrit shloka** (`shloka.ts` + `agent/neura/shlokas.json`): ~105 curated verses (Gita, Upanishads, shanti mantras, Chanakya, Panchatantra, Hitopadesha, subhashitas) — one per new session, bottom-right below editor, Devanagari + meaning + source, sequential rotation via `shloka-state.json`, hides on first message.

## 2026-07-21 — Phase 1 + Cockpit v1

**Phase 1 — skills unification**
- pi upgraded 0.79.3 → 0.81.0 (pi-subagents needed newer internals; later auto-bumped to 0.81.1)
- `settings.json`: `"skills": ["~/.claude/skills"]` — all 46 Claude Code skills load in pi natively
- Deleted 17 duplicated skill copies from `~/.pi/agent/skills/`

**Packages (vetted then installed)**
- `@spences10/pi-redact@0.0.14` — redacts tokens/keys/connection strings from tool output
- `@spences10/pi-lsp@0.0.41` — LSP diagnostics into the agent loop
- `pi-subagents@0.35.1` — subagent delegation, chains, parallel, background runs
- Vet result: no install scripts, no telemetry, all exec calls explainable

**Custom extensions**
- `guardrail.ts` — block-and-ask destructive commands + secret-file access
- `ship-report.ts` — end-of-iteration report format injection
- `presets.ts` — `/preset gpt|qwen`, local llama.cpp provider
- `skill-doctor.ts` — `/skill-doctor` flags Claude-only skills
- Fixed latent stale-ctx crash in pre-existing `autogit.ts`

**Cockpit v1 (Neura)**
- `neura.ts` — ASCII logo, time-aware greeting, automatic dashboard (Obsidian todos · session-store projects · week goals), `/dash`, persona injection
- `cockpit.ts` — 4-field footer (model · branch · ctx% · cost), status line on demand
- `neura-dark.json` theme, `NEURA.md` persona (no emojis), `neura.cmd` launcher
- Verified: persona answers as Neura; launcher works

**Deferred**
- Per-tool color badges (READ/WRITE/EDIT/BASH) — pi built-in tool override requires reimplementing `execute`; postponed to v1.1
- MCP bridge (Phase 2 Part A) — waiting on Context7/Supabase/Notion tokens as env vars

**Security notes**
- GitHub token found in plaintext in `.claude.json` — to be moved to env var and rotated in Phase 2

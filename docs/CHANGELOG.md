# Changelog

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

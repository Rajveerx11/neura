# Changelog

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

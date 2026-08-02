# Changelog

## 2026-08-02 — v2.4.1 (launch hierarchy correction)

- Removed the three-way Human Away duplication across the launch ledger, idle cockpit rail, and footer. Launch now owns mode and workspace context; the footer contracts to model/context until launch clears.
- Removed zero-value `/notices`, the redundant dirty asterisk, and persistent `MCP 0/3 connected` footer noise. Third-party status appears only while work is active.
- Replaced full-width copper editor rails with neutral structural borders.
- Added merge-safe settings exclusions for the skipped `~/.agents` copies of `agent-reach` and `find-skills`, preserving the active `~/.claude` copies and all local model/provider choices.

## 2026-08-02 — v2.4 (terminal cockpit redesign)

- Restored the original six-line NEURA ASCII wordmark at launch, with a five-line fallback below 56 columns. The resume ledger now keeps workspace, dirty state, active safety boundary, last work, next action, and `/notices` discoverable without the old greeting-heavy dashboard.
- Added shared cockpit state for briefing, work, review, proof, recovery, completion, degraded capability, checkpoint, approval, and transcript-copy signals.
- Rebuilt the footer around responsive survival order: mode, model, branch, context, and cost. Human Away is amber and always includes `PREVIEW`; v2.4.1 removes fields already owned by the visible launch ledger.
- Replaced decorative mode rails with a seven-line capability latch. Workspace, reviewer, sensitive-action, and remote boundaries settle in reading order within 360 ms; latest transition wins; `NEURA_REDUCED_MOTION=1` renders the final state only.
- Reframed approvals as Neura action requests: agent, task, intent, exact action, reviewer evidence, policy boundary, safer fallback, and one-use grant scope. Denial is the default focused choice.
- Added `/clip` and Ctrl+Shift+X using Pi's supported clipboard API. Whole-answer copy preserves Markdown; code copy excludes fences; the action rail exposes block count and stable 1.2-second feedback.
- Rethemed assistant Markdown, links, code, tools, diffs, thinking, selections, and editor surfaces with Forged Tungsten semantic tokens. No global Pi package or Windows Terminal settings are patched.
- Reworked health into an aligned capability ledger and routed checkpoints, proof checks, autogit, failures, and recovery through the shared cockpit instead of duplicate success noise.
- Expanded deterministic verification across the ASCII launch, title, five widths, footer collapse, transcript actions, agent-focused approval hierarchy, Human Away Preview labeling, and keybinding ownership.

## 2026-08-02 — v2.3 (Plan, YOLO, and Human Away v1)

- Added `modes.ts`: Shift+Tab cycles Plan → YOLO → Human Away; `/mode` supports direct selection and status. Pi's thinking-level cycle moves to Ctrl+Shift+T through a merge-safe `keybindings.json` install.
- Added mode-specific terminal transitions within Pi's 10-line widget limit and responsive bounds; v2.4 replaces their initial decorative treatment with the final capability latch.
- Plan mode uses a fixed read-only tool set and exact shell allowlist. Chained commands, mutations, protected reads, and unknown tools fail closed.
- YOLO preserves autonomous workspace behavior while sensitive deletes, secret access, force-push, destructive git, protected control edits, and high-impact infrastructure actions still require interactive approval.
- Human Away is an opt-in native-Windows preview. A separate ephemeral Pi Headmaster launches with no session, tools, extensions, skills, prompt templates, or context files. It receives only a sanitized dossier and strict JSON policy.
- Deterministic policy clamps every Headmaster verdict. v1 auto-approval is limited to one generated, untracked file inside the workspace. Secrets, control files, opaque shell, remote mutation, and unaudited custom tools defer; broad destruction is policy-denied.
- Added sanitized SHA-256 hash-chained approval audit, workspace-bound action fingerprints, 120-second one-use retry grants, duplicate suppression, and a three-consecutive/ten-in-fifty denial circuit breaker.
- Added `/approvals` and return-time queue surfacing. Human approval creates an exact retry capability; stale commands are never replayed directly.
- Closed automatic-hook bypasses: Plan skips checkpoint mutation and autogit; Human Away holds autogit shipping and suppresses October transcript export.
- Expanded `verify-harness.mjs` across mode isolation, animation widths, Plan restrictions, YOLO fail-closed approval, Human Away queueing, cross-extension grant consumption, non-reuse, return UI, footer state, and circuit breaking.
- Known boundary remains explicit: native Windows has no OS-enforced workspace sandbox. Human Away stays preview-labelled until that boundary and an adversarial replay suite exist.

## 2026-07-31 — v2.2 (second brain: /preset opus)

- **Root cause of "I trust Claude Code more" was the model, not the harness.** `auth.json`
  held exactly one credential (`openai-codex`) and `models-store.json` cached exactly one
  provider, so Neura was structurally incapable of running anything but gpt-5.5 while
  Claude Code ran Opus 5. The harness was never the weak part.
- **`/preset opus`** — pi 0.82.1 added Claude Opus 5 on the `anthropic` provider plus
  Claude Pro/Max OAuth via `/login`. Neura can now switch brains per task.
  Cost caveat recorded deliberately: pi bills third-party harness usage as Claude
  **extra usage**, per token — it does *not* draw on plan limits. `gpt` stays the default
  because Codex usage is included in the ChatGPT subscription.
- **Preset resolution is prefix-based, not exact.** Catalog IDs carry date suffixes
  (`claude-opus-5-2026xxxx`); `find()` alone would miss them. Exact match first, then the
  newest prefix match from `modelRegistry.getAll()`.
- **`pi.setModel()` rejection no longer escapes the command** — a bad or expired credential
  now reports which model was attempted and which provider to `/login`, instead of an
  unhandled rejection.
- `scripts/verify-harness.mjs` covers preset resolution: dated-ID prefix pick, missing-model
  login hint, and the full preset listing.

## 2026-07-28 — v2.1 (Forged Tungsten + Continuity Spine)

- Replaced Orchid Dusk with Forged Tungsten: tungsten neutrals, one burnt-copper
  brand accent, bone text, and semantic colors reserved for real outcomes.
- Removed the decorative logo gradient and three-column launch dashboard.
- Added a responsive LAST/NOW/NEXT continuity launch backed by local session
  timestamps and current git state. Transcript contents are never parsed.
- Removed calendar, Obsidian task, and weekly-goal launch reads to reduce startup
  work and permanent information noise.
- Kept `/dash` as the existing toggle command while changing its surface to the
  continuity launch.

## 2026-07-28 — v2.0 (agentic engineering console)

- Added a shared harness core for palette, ANSI layout, process checks, and git health.
- Rebuilt the launch UI as a width-aware console: full wordmark and three columns on wide terminals, compact identity and stacked summaries on narrow terminals.
- Added `/health` for runtime, workflow, context, workspace, MCP, and local-model readiness.
- Made the footer responsive and exposed checkpoint/proof-of-work activity only while those operations run.
- Expanded destructive-operation coverage and made sensitive operations fail closed when interactive approval is unavailable.
- Added `install.ps1 -Check` drift/prerequisite diagnostics and `-ForceSettings` for explicit settings replacement.
- Added `scripts/verify-harness.mjs`, a deterministic extension-load, responsive-layout, health, footer, and guardrail test.

## 2026-07-24 — v1.9 (Phase 3D: subagent delegation + skill audit + context7 key)

- **Subagent delegation wired into persona** — one NEURA.md rule: `scout` before unfamiliar code, `oracle` for risky decisions, `reviewer` on the diff after non-trivial implementations; skip for trivial edits. No config needed — pi-subagents ships 8 builtin agents ready to use. Verified headless: agent lists all 8, `delegate` spawn round-trips (returned PONG).
- **Skill audit run** (skill-doctor logic): 30 skills scanned, 7 flagged for Claude-only tool references — build-premium-website, learn-post, linkedin-post-writer, remotion-video-prompt, shorts (AskUserQuestion); plan-day, trigger-dev (`mcp__` tool names). Port case by case only if one misfires in pi.
- **CONTEXT7_API_KEY set** as user env var (reaches the server via MY_PI_MCP_ENV_ALLOWLIST — never in mcp.json). Verified live: context7 resolved `/colinhacks/zod` in a headless Neura session.
- **Supabase and Notion skipped** by user decision — notion now `"disabled": true` in mcp.json like paper/supabase (NOTION_TOKEN unset; an enabled server with no token is a startup failure waiting to happen).
- Telemetry/observability deferred — no pain it solves yet; revisit if check-gate or subagents misbehave in daily use.

- **`neura-memory.ts`** — cross-session memory, Claude Code model: `~/.pi/agent/neura/MEMORY.md`, one bullet per fact, injected into every turn's system prompt; the agent is told the path so it can update its own memory with file tools. `/remember <fact>` saves (dated), `/memory` shows. Verified: fact recalled in a fresh headless session. MEMORY.md gitignored — personal data stays out of the repo.
- **`@spences10/pi-context@0.1.12` installed** (vetted: no network, no child processes, local SQLite only) — oversized tool/MCP output lands in a searchable sidecar instead of being truncated at 50 KiB; pi-mcp integrates with it automatically.
- Supermemory decision recorded: deferred — its MCP server can drop into mcp.json later if deep semantic recall over long history becomes a real need.
- Phase 3 (A+B+C) complete: Neura now verifies its own work, can undo its own edits, and remembers across sessions.

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

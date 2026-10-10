# Neura Usage for Herdr

A global Herdr plugin that places read-only Claude Code, Codex, and Cursor CLI quota tokens beside the agent panes that use them.

## Behavior

- When separately linked, the plugin runs at Herdr startup and on agent/focus events, so every new or restored session receives the current token. The Neura Pi bridge reports the active Pi model provider only when `NEURA` and `HERDR_ENV=1` are both set; plain Pi does not register callbacks.
- It only queries providers represented by active Herdr agent panes. Pi's subscription provider comes from the current `agent list` entry's `tokens.usage_provider`; unrelated agents (including `fx`) are not treated as Codex.
- Results are cached for two minutes. The `Refresh AI usage` plugin action bypasses that cache. `$usage` metadata has a TTL bounded by the result's remaining cache lifetime; cache hits do not restart that lifetime. Without another existing event or manual refresh, the token expires instead of displaying an indefinitely old quota. No polling loop, daemon, or scheduled process is added.
- It reports compact remaining percentages (`5h 80% · Wk 25%`) only from actual provider rate-limit windows. Codex windows with missing durations use `Primary`/`Secondary`, not guessed 5-hour/weekly labels; absent or invalid percentages never become an invented limit. The local cache stores rendered usage and credential-file revision metadata (timestamps, size, inode) so a normal login or account switch invalidates stale usage. No account identifier, response body, access token, or credential path is logged or cached.
- Authentication is read-only. Missing, API-key-only, expired/failed credentials or absent Codex rate-limit windows display `limits unavailable`, with a two-minute metadata TTL (or the remaining cache lifetime). Failed fetches discard previous provider usage, never a stale-percentage fallback. Claude/Cursor retain their existing unavailable/clear behavior. The plugin never refreshes, rotates, or writes an agent credential.
- Automatic CLI calls require Herdr to supply an existing absolute `HERDR_BIN_PATH`; no executable is resolved from the workspace or ambient PATH. Each call and HTTPS request has a deadline. Herdr resolves the plugin manifest's `node` command from its own environment; this optional plugin must be linked only in a trusted Herdr installation.

## Supported authentication

| Provider | Agent kinds | Local credential source | Endpoint |
| --- | --- | --- | --- |
| Claude Code / Pi with Anthropic | `claude`, `claude-code`, `anthropic`, Pi `anthropic` | `~/.claude/.credentials.json` | Anthropic OAuth usage |
| Codex / Pi with ChatGPT subscription | `codex`, Pi `openai-codex` | `$CODEX_HOME/auth.json` or `~/.codex/auth.json` | ChatGPT usage |
| Cursor CLI / Pi with Cursor | `cursor`, Pi `cursor` | Cursor CLI `auth.json` | Cursor usage summary |

Codex API-key authentication does not expose an account quota window: an active Codex pane shows `limits unavailable`, not a percentage. Pi only marks providers known to be subscription-backed; a plain `openai` API-key model is never presented as a ChatGPT quota.

## Codex limits availability and metadata

Herdr's documented pane metadata API is display-only: `--token usage=...` feeds the custom sidebar `$usage` field. Neither agent lifecycle state nor Herdr's documented API supplies account rate limits; those come only from the existing authenticated ChatGPT usage endpoint. Token patches are not guarded by `--agent`/`--applies-to-source`, and without `--ttl-ms` they remain until replaced, cleared, or the pane closes. This reporter now sets that TTL and clears previously tracked panes when they leave the supported provider set.

The actual callers are the manifest's one-shot startup hook, `pane.agent_detected`, `pane.agent_status_changed`, `pane.focused`, and the `refresh` action (`--force`). The optional Neura Pi bridge (`agent/extensions/herdr-usage-provider.ts`) reports `usage_provider` and invokes that action on session start/model selection. The manifest and bridge are unchanged. Linking, enabling, client attachment, and config reload do not run startup hooks; metadata-only changes are not a new polling trigger.

If Codex is **not running** (and no active Pi pane reports `usage_provider=codex`), no Codex credentials or endpoint are queried and cached Codex usage is not shown on unrelated agents. Previous tracked `$usage` values are cleared on the next existing hook/action; newly reported values also expire automatically. There is deliberately **no stale usage fallback**. A missing provider token on Pi means no subscription provider is known, not evidence of available or exhausted limits.

Read-only inspection on 2026-10-09 confirmed client/server `0.9.3`, enabled global `neura.usage` linked to this directory, and no active Codex or Pi `usage_provider` metadata. Before this fix, unavailable auth/fetch results silently cleared `$usage`, while successful reports omitted metadata TTL. The local Herdr checkout describes itself as `v0.9.1` and has unrelated user changes; its `docs/next` metadata/plugin documentation was cross-checked against installed CLI help. No Herdr source, configuration, other integration, credentials, or item18 note was changed; no account request or refresh action was invoked during verification.

## Global installation

Link this directory once; Herdr stores the link in its global plugin registry, so it applies to all future local Herdr sessions:

```powershell
herdr plugin link <path-to-neura>\integrations\herdr-usage
```

Show the token in the global Herdr sidebar configuration:

```toml
[ui.sidebar.agents]
rows = [
  ["state_icon", "workspace", "tab"],
  ["agent", "state_text", "$usage"],
]
```

Reload Herdr configuration after changing it:

```powershell
herdr server reload-config
```

Use the `Refresh AI usage` plugin action from Herdr when an immediate update is needed.

## Verification

```powershell
node --test .\integrations\herdr-usage\usage-report.test.mjs
node --check .\integrations\herdr-usage\usage-report.mjs
```

Item18 verification (2026-10-09), run from `/mnt/c/Neura` in WSL using Windows Node `v24.19.0`:

```bash
'/mnt/c/Program Files/nodejs/node.exe' --test integrations/herdr-usage/usage-report.test.mjs
'/mnt/c/Program Files/nodejs/node.exe' --check integrations/herdr-usage/usage-report.mjs
'/mnt/c/Program Files/nodejs/node.exe' scripts/verify-harness.mjs
'/mnt/c/Program Files/nodejs/node.exe' scripts/check-docs.mjs
git diff --check
```

All exited `0`: 16 deterministic focused tests, syntax check, all 18 independent harness suites, 36-file documentation check, and whitespace check. Focused tests use synthetic auth, responses, time, cache and metadata reports; they cover TTL/cache hits, exact expiry, credential revisions, forced refresh, absent/invalid limits, failed fetches, provider routing, and no-running-Codex clearing without auth/network access. The harness skips POSIX cooperative process probes on Windows; its sandbox test is a contract check, not a live WSL replay.

Before edits, byte-for-byte backups of `README.md`, `usage-report.mjs`, and `usage-report.test.mjs` were verified under `.backups/item18-20261009T172732Z/` (each filename ends in `.bak`). Only those three existing files changed. No live account fetch, Codex startup, plugin action, config reload, server restart, or install was performed. Actual account quota availability, live sidebar rendering and server TTL expiry remain unverified; numeric limits require a running supported pane and a successful subscription usage response.

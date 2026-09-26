# Neura Usage for Herdr

A global Herdr plugin that places read-only Claude Code, Codex, and Cursor CLI quota tokens beside the agent panes that use them.

## Behavior

- When separately linked, the plugin runs at Herdr startup and on agent/focus events, so every new or restored session receives the current token. The Neura Pi bridge reports the active Pi model provider only when `NEURA` and `HERDR_ENV=1` are both set; plain Pi does not register callbacks.
- It only queries providers represented by active Herdr agent panes.
- Results are cached for two minutes. The `Refresh AI usage` plugin action bypasses that cache.
- It reports only a compact remaining percentage (`5h 80% · Wk 25%`); no account identifier, response body, token, or credential path is logged or cached.
- Authentication is read-only. Expired or unsupported credentials result in no token; the plugin never refreshes, rotates, or writes an agent credential.
- Automatic CLI calls require Herdr to supply an existing absolute `HERDR_BIN_PATH`; no executable is resolved from the workspace or ambient PATH. Each call and HTTPS request has a deadline. Herdr resolves the plugin manifest's `node` command from its own environment; this optional plugin must be linked only in a trusted Herdr installation.

## Supported authentication

| Provider | Agent kinds | Local credential source | Endpoint |
| --- | --- | --- | --- |
| Claude Code / Pi with Anthropic | `claude`, `claude-code`, `anthropic`, Pi `anthropic` | `~/.claude/.credentials.json` | Anthropic OAuth usage |
| Codex / Pi with ChatGPT subscription | `codex`, Pi `openai-codex` | `$CODEX_HOME/auth.json` or `~/.codex/auth.json` | ChatGPT usage |
| Cursor CLI / Pi with Cursor | `cursor`, Pi `cursor` | Cursor CLI `auth.json` | Cursor usage summary |

Codex API-key authentication does not expose an account quota window and is intentionally not shown. Pi only marks providers known to be subscription-backed; a plain `openai` API-key model is never presented as a ChatGPT quota.

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

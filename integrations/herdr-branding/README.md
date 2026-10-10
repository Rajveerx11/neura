# Herdr inline harness marks

Small text-mode logo approximations in the former harness-wordmark position,
beside native `idle`/`working`/`blocked` status. One terminal row, one character
per mark except the two-character fx wordmark; no large artwork rows.

Current marks: Pi `π`, Claude `✳`, Codex `❋`, Gemini `✦`, Hermes `☤`,
OpenCode `▣`, fx `ƒx`, DeepSeek `≈`, Neura `N`. These are Unicode approximations,
not embedded official logo images; glyph appearance depends on terminal fonts.
Only generic Unicode text marks are distributed. Local legacy rasterized artwork
is excluded from Git until applicable redistribution terms are established.
The detailed Codex/Neura/Hermes/Claude artwork redesign remains deferred.

`branding.mjs` publishes only `herdr_brand_icon` from source `neura.branding`,
clearing all six legacy artwork tokens and old captions/markers. Native identity,
names, lifecycle, state labels, sessions, mode, usage and provider data stay intact.
Source sequences precede reads; bounded read-back reconciles races. Per-pane
failures are counted independently. No raw runtime responses/private data logged.

`prepareSidebar` in `sidebars.mjs` migrates standalone old artwork rows, inserts the
inline token immediately before the native agent-label token, and preserves status
and other rows/styles. Exact wordmark hide rules retain custom native names; a
manual name identical to a hidden wordmark is also hidden, not erased. Migration
is idempotent, preserves unrelated overrides, and refuses mixed user/artwork rows,
missing headers and 16-row/token/rule cap violations without mutating input.

Neura remains native Pi; only external explicit display `Neura` selects `N`.
Automatic Neura tagging is not installed. fx/DeepSeek use genuine custom reporting
and the generic base layout, not invented canonical keys. Six canonical overrides
cover Pi, Claude, Codex, Gemini, Hermes and OpenCode. No live DeepSeek was verified.

## Runtime and checks

This directory provides source only; publication does not install or activate it.
An operator may separately deploy a verified runtime copy to Herdr's global
local-plugin directory so checkout cleanup cannot break active hooks. Once linked
and enabled, `neura.branding` declares detection/status/focus and future-startup
hooks. Requires explicitly authorized activation, Node and compatible Herdr 0.9.1+.
`prepareSidebar` is a pure helper, not an automatic configuration installer.

```sh
node --test integrations/herdr-branding/branding.test.mjs
node --check integrations/herdr-branding/branding.mjs
node --check integrations/herdr-branding/sidebars.mjs
herdr config check
```

After config changes use `herdr server reload-config`; existing clients may need
Herdr's configured `Ctrl+Shift+R` shortcut. Do not send this key to an agent pane.
Tests use synthetic public contracts; they do not establish live activation,
server compatibility, metadata/configuration state, or rendering in every font.
Live verification must be separately authorized and recorded for the target.

For runtime updates, disable the plugin and ensure its invocations are quiescent,
verify ownership hashes, back up/replace only task-owned files, link/re-enable,
and refresh. For rollback quiesce, run `node <runtime>/branding.mjs --clear`, then
reverse only task-owned config edits and restore the verified runtime backup.
Keep unrelated settings/plugins/agents intact; do not restart/kill user sessions.

Safe inline migration reports/checksums/backups live in
`.pi-subagents/reports/herdr-branding/inline/`. Runtime-owned logs stay in Herdr's
own directories. LSP unavailability is not a clean type-check result.

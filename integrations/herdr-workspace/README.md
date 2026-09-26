# Neura Workspace for Herdr

A local Herdr 0.9.1 plugin that keeps Obsidian notes and Google Calendar inside terminal panes.

## Actions

Use Herdr's `Open editable Obsidian notes` or `Open Google Calendar` plugin action to open a right split. This plugin does not register keyboard shortcuts; assign them in your own Herdr configuration if desired. In Notes, selecting a note launches GNU nano on the Markdown file. `Ctrl+O`, Enter saves; `Ctrl+X` returns to the picker.

The Notes pane reads the vault configured at `~/.pi/agent/neura/learn-vault.json` when the pane opens. Refresh updates the note list; reopen the pane after changing the vault configuration. New notes are created below `Herdr Notes/` in that vault.

Calendar is an **experimental, user-managed opt-in**, not an installed or reviewed Neura runtime dependency. If you choose to use it, review [gcalcli's source](https://github.com/insanum/gcalcli), install the exact version `gcalcli==4.5.1` yourself, then set `NEURA_GCALCLI_EXECUTABLE` to its absolute executable path and `NEURA_GCALCLI_SHA256` to that file's SHA-256 before launching Herdr. Matching a locally supplied hash pins bytes but does not establish upstream provenance. No ambient `gcalcli` on PATH is executed. On first use, choose `a` and complete Google OAuth only when you are ready to grant access. Authentication files are owned by gcalcli under the user's local application-data directory and are never written to this repository or displayed in Herdr.

## Development

Requires Node.js 24+ (the Notes pane imports Neura's guarded TypeScript vault helpers). Run `node --test integrations/herdr-workspace/workspace.test.mjs` from the Neura root. The tests use a disposable vault, not your Obsidian notes; the manifest test requires the local Herdr plugin to be linked and enabled.

```powershell
herdr plugin link C:/Neura/integrations/herdr-workspace
herdr plugin action invoke neura.workspace.open-notes
herdr plugin action invoke neura.workspace.open-calendar
```

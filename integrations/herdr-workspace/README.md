# Neura Workspace for Herdr

A local Herdr 0.9.1 plugin that keeps Obsidian notes and Google Calendar inside terminal panes.

## Shortcuts

- `Ctrl+Shift+O` or `prefix+u`: open an Obsidian note picker in a right split. Selecting a note launches GNU nano on the exact Markdown file. `Ctrl+O`, Enter saves; `Ctrl+X` returns to the picker.
- `Ctrl+Shift+L` or `prefix+y`: open Google Calendar in a right split. Choose month, two-week, or agenda views; add and edit events without opening a website.

The Notes pane reads the vault configured at `~/.pi/agent/neura/learn-vault.json` every time it refreshes. New notes are created below `Herdr Notes/` in that vault.

The Calendar pane uses **gcalcli 4.5.1** (`uv tool install 'gcalcli==4.5.1'`; for an existing install, `uv tool upgrade 'gcalcli==4.5.1'`). On first use, choose `a` and complete Google OAuth only when you are ready to grant access. Authentication files are owned by gcalcli under the user's local application-data directory and are never written to this repository or displayed in Herdr.

## Development

Requires Node.js 24+ (the Notes pane imports Neura's guarded TypeScript vault helpers). Run `node --test integrations/herdr-workspace/workspace.test.mjs` from the Neura root. The tests use a disposable vault, not your Obsidian notes; the manifest test requires the local Herdr plugin to be linked and enabled.

```powershell
herdr plugin link C:/Neura/integrations/herdr-workspace
herdr plugin action invoke neura.workspace.open-notes
herdr plugin action invoke neura.workspace.open-calendar
```

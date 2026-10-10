# Neura Workspace for Herdr

A local Herdr 0.9.1 plugin that keeps Obsidian notes and Google Calendar inside terminal panes.

## Actions

Use Herdr's `Open editable Obsidian notes` or `Open Google Calendar` plugin action to open a right split. This plugin does not register keyboard shortcuts; assign them in your own Herdr configuration if desired.

In Notes, numbers refer to the currently displayed (possibly filtered) list:

| Input | Action |
| --- | --- |
| `1` | Edit note 1 with GNU nano; `Ctrl+O`, Enter saves, `Ctrl+X` returns to Notes |
| `r1` or `v1` | Preview note 1 as rendered Markdown with Leaf; close Leaf to return to Notes |
| `/text` | Filter note paths |
| `n` | Create a note and edit it with nano |
| `r` or `refresh` | Refresh the list and clear the filter |
| `q` | Close the Notes pane |

Leaf is an optional, user-installed terminal viewer. Discovery happens only after an explicit numbered preview selection: native `leaf.exe` on the Windows process's PATH, then `%LOCALAPPDATA%\Programs\leaf\leaf.exe` (for example `C:\Users\rajve\AppData\Local\Programs\leaf\leaf.exe`); native `leaf` on Linux/macOS PATH, then `~/.local/bin/leaf` (on this Linux setup, `/home/rajveer/.local/bin/leaf`). Relative/empty PATH entries are ignored; Windows `.cmd`/`.bat` wrappers are not used. A Linux Notes process never launches the Windows viewer. No installation or global configuration changes are performed by this integration.

The selected note passes the same `checkedNote` authorization as editing: it must be an unlinked Markdown file within the canonical vault, without linked directory ancestors. Leaf receives the absolute native note path as one literal argument, with no shell. It opens interactively in the existing Notes pane only when requested, never at startup, on refresh, or through a watcher. The integration does not read Leaf history/configuration or request those commands. If Leaf is missing or fails, Notes shows a clear error; press Enter to return to the picker and continue editing with nano. Preview does not create or rewrite notes.

The Notes pane reads the vault configured at `~/.pi/agent/neura/learn-vault.json` when the pane opens. Refresh updates the note list; reopen the pane after changing the vault configuration. New notes are created below `Herdr Notes/` in that vault.

Calendar is an **experimental, user-managed opt-in**, not an installed or reviewed Neura runtime dependency. If you choose to use it, review [gcalcli's source](https://github.com/insanum/gcalcli), install the exact version `gcalcli==4.5.1` yourself, then set `NEURA_GCALCLI_EXECUTABLE` to its absolute executable path and `NEURA_GCALCLI_SHA256` to that file's SHA-256 before launching Herdr. Matching a locally supplied hash pins bytes but does not establish upstream provenance. No ambient `gcalcli` on PATH is executed. On first use, choose `a` and complete Google OAuth only when you are ready to grant access. Authentication files are owned by gcalcli under the user's local application-data directory and are never written to this repository or displayed in Herdr.

## Development

Requires Node.js 24+ (the Notes pane imports Neura's guarded TypeScript vault helpers). Run `node --test integrations/herdr-workspace/workspace.test.mjs` from the Neura root. Tests use disposable vaults and mocked Leaf/nano spawns; they do not open a viewer or edit your Obsidian notes. The manifest test verifies source only; no live Herdr process, plugin state, viewer, or account is queried.

```powershell
herdr plugin link C:/Neura/integrations/herdr-workspace
herdr plugin action invoke neura.workspace.open-notes
herdr plugin action invoke neura.workspace.open-calendar
```

# Support

Neura is experimental and community-supported. Current `main` is a Mastra
development build with Work and Learn. `v2.5.1` is the historical Pi release.
There is no production-support or response-time commitment.

## Get help

Read the [README](README.md) and [status](docs/STATUS.md). Find the relevant
[guide](docs/README.md), then search [existing issues](https://github.com/Rajveerx11/neura/issues).
For a reproducible defect, use the bug form with the source commit, package
version, Windows/shell/Node versions, mode, provider kind, safe reproduction and
short redacted error. A package version alone cannot identify a mutable source build.
Include a Pi version only for a historical Pi installation.

Never post credentials, authorization URLs/callbacks, private code, memory,
transcripts, approval records, provider bodies or personal paths. Report
vulnerabilities privately through [Security](SECURITY.md).

## Common problems

| Symptom | Next step |
| --- | --- |
| Missing Learn dependency | Run `npm ci --prefix agent/neura --ignore-scripts` in the source checkout. Install both locked graphs for a fresh setup. |
| `--check` passes but a command fails | It does not test WSL. Work requires WSL2/bubblewrap and tools inside the distro's `/usr`. There is no host fallback. |
| Dependency installation is refused | Install manually in WSL from the project directory. The command sandbox is offline and common installers are refused immediately. |
| Commands fail in a linked worktree | Gitfiles are refused at any depth. Use an external manual terminal until Git-directory targets can be protected. |
| Work cannot access `memory`, `sessions`, `private` or `secrets` | Those path components remain protected, even in ordinary projects. Do not weaken the boundary to bypass it. |
| Review is unavailable | Use a Git repository with committed HEAD within snapshot bounds. Unreviewed output is not clean review evidence. |
| Work reaches its step limit | Inspect effects, then ask it to continue. Its original baseline is retained. Context compaction is not implemented. |
| `/verify` or `/verify full` is unavailable | Full trusted proof is blocked. Quick proof separately needs reviewed offline artifacts and interactive approval. See [verification](docs/VERIFICATION.md). |
| Learn cannot create its store | First creation requires native Windows and an unlinked workspace. Preserve unowned `.neura-learning` content. |
| Obsidian capture is absent | Opt in with `NEURA_LEARN_VAULT` or Neura home's `learn-vault.json`. No legacy Pi config is read. Use a real local vault with `.obsidian/` and an absent or Neura-owned `Neura/` subtree. |
| A vault warning appears | Learning continues. Inspect ownership, links, integrity, projection collisions and the event bound. Preserve ambiguous/user-edited files. |
| Board answers do not reach Neura | Copy the revision-bound command into the terminal. Browser state does not sync automatically. |
| Resumed citations are historical | Reimport the original document. Snapshots omit images and do not prove current source contents. |
| PPTX layout or OCR is incomplete | Export full slide layouts or legacy `.ppt` to PDF/PPTX. English OCR can misread formulas and handwriting. |
| An old command or mode is missing | Plan, YOLO, Human Away, `/health`, `/undo`, `/ship`, MCP/LSP and delegation are unavailable in the active CLI. |

## Provider errors

Use [authentication guidance](docs/CODEX_AUTH.md) for DACL inspection, explicit
login, model selection and sanitized transport errors. The owner reported working
subscription responses after earlier repairs. Complete entitlement and
refresh/restart coverage remain open. `--help`/`--check` need no credentials.

For a failed request, retain only the fixed sanitized error and source commit.
Do not repeatedly log in, reinstall or switch to separately billed APIs as a
speculative repair. Explicit API provider selection can incur charges. Subscription failure never selects it automatically.

Do not delete lock files, credentials, sessions, vaults, backups or user files to
force recovery. See [development](docs/DEVELOPMENT.md) and
[installer limits](docs/INSTALLER_READINESS.md).

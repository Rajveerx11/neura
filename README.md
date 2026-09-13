# Neura

[![Verify](https://github.com/Rajveerx11/neura/actions/workflows/verify.yml/badge.svg)](https://github.com/Rajveerx11/neura/actions/workflows/verify.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-experimental-amber.svg)](docs/STATUS.md)

Neura is a Windows-first engineering-agent harness built on
[`@earendil-works/pi-coding-agent`](https://pi.dev). It adds a focused terminal
interface, explicit operating modes, verification, recovery, local memory,
model presets, and policy guardrails around stock Pi.

Latest release: **2.5.1**. Current `main` targets Pi `0.84.4` and includes
unreleased Work, Learn, and verification improvements. These docs describe that
merged source; older checkouts and live installations may differ. Neura is
Apache-2.0-licensed experimental software; public repository visibility is
still pending. It is **not production-ready**. Human Away remains
preview-only and is not approved for unattended high-impact work. Read
[current status](docs/STATUS.md), [security policy](SECURITY.md), and
[known production blockers](docs/PRODUCTION_READINESS.md) before use.

## Highlights

- Five modes: Plan, Work (default), YOLO, Human Away Preview, and Learn.
- Practical learning with short bullets, flow/ER/sequence diagrams, exercises,
  and page/slide references from local PDFs and PPTX decks.
- Image-backed centred launch in a dedicated Windows Terminal profile, with a
  logo-only fallback and responsive Forged Tungsten terminal interface.
- Local HTML plan publication with escaping, content security policy, stable
  hashes, and machine-readable lifecycle events.
- WSL2 and bubblewrap isolation for Work execution and Human Away commands.
- Git-backed in-session checkpoints and `/undo` in YOLO.
- Proof-of-work verification, health diagnostics, responsive terminal UI, local
  memory, model presets, and optional MCP integrations.
- Exact dependency pins, Windows CI, accessibility checks, complete-history
  secret scanning, and documentation validation.

Presence of a control does not establish a complete security boundary. See
[Security](#security-and-limitations) for limits that matter.

## Modes

| Mode | Intended use | Boundary |
|---|---|---|
| Plan | Research and design before implementation | Workspace-contained reads, bounded web search, restricted Git inspection, and writes only through `publish_plan` under `plans/`. |
| Work (default) | Supervised implementation | Contained workspace reads/edits/writes; `work_exec` runs commands through WSL2 bubblewrap without network. Protected and remote actions require explicit interactive approval; headless requests fail closed. |
| YOLO | Deliberate full-access work | Requires interactive confirmation. Neura application approvals and tool blocking are disabled. Native Windows gives the process the signed-in user's authority. |
| Human Away Preview | Low-risk work while the operator is unavailable | Exposes only `human_away_exec` through WSL2 bubblewrap. Host user paths and network are hidden; only the active workspace is writable. Deterministic policy and an isolated reviewer still apply. |
| Learn | Practical technical or nontechnical learning | Bounded reads, web search, questions, and four learning tools. Local lessons and progress use controlled storage; arbitrary shell, generic writes, and MCP tools are unavailable. |

Shift+Tab cycles Plan, Work, YOLO, Human Away, and Learn.
`/mode plan|work|yolo|human-away|learn` selects one directly.
Every transition into YOLO requires confirmation. Ctrl+Shift+T owns Pi's
thinking-level shortcut.

Plan publication works in TUI, print, JSON, and RPC runs. Each active request
gets at most one automatic publication retry. Consumers receive a versioned
`neura-plan-contract` session event for either a published artifact or a final
`PLAN_ARTIFACT_MISSING` failure.

## Learn by doing

1. Enter `/mode learn` and name a practical goal, such as designing a shop database.
2. Ask for one concept, 3-5 key bullets, an ER diagram, and a small exercise.
3. Give a local PDF or PPTX path inside the workspace to ground lessons in your material.
4. Open the generated local learning board. Use hints, then submit with
   `/learn answer <text or SQL>` or the board's copy-to-terminal control.
5. Use `/learn save` to keep progress; `/learn saved` and `/learn resume <filename>`
   restore it explicitly.

PDFs include page previews and offline English OCR. PPTX supports text, notes,
and embedded image previews; export slides to PDF for full layouts and charts.
Browser progress does not automatically sync. Saved images are omitted, and
resumed sources must be reimported before new verified citations. See the
[Learn guide](docs/LEARN_MODE.md) for commands, limits, and worked-answer behavior.

## Requirements

- Windows 11 or a current supported Windows release.
- PowerShell, Git, Node.js **24.15+** with npm, and Pi `0.84.4`.
  CI exercises Node `24.16.0`.
- uv/`uvx` `0.12.11`, hash-pinned WSL CPython `3.12.3`, and the five reviewed
  proof wheels in a dedicated wheelhouse configured by `NEURA_WSL_UV_DIR` and
  `NEURA_WSL_PROOF_WHEELHOUSE`.
- WSL2 plus `bubblewrap` for Work execution/proof and Human Away Preview.
  Work and YOLO proof require the exact runner and packages already available
  offline inside WSL; unavailable isolation never falls back to host execution.
- Provider credentials for whichever models or optional integrations you enable.

The complete application workflow is supported on Windows. Linux CI covers
selected portable contracts, not a supported Linux installation. Learn store
creation requires native Windows; existing validated stores can be used on POSIX.

`"private": true` in `package.json` prevents accidental npm publication. It
does not determine GitHub repository visibility or software license.

## Install from source

Review [security limits](SECURITY.md) and installer before running it.

```powershell
npm install -g @earendil-works/pi-coding-agent@0.84.4
git clone https://github.com/Rajveerx11/neura.git
Set-Location .\neura
npm ci --ignore-scripts
npm ci --prefix agent/neura --ignore-scripts
npm run verify
powershell -File .\install.ps1
pi update --extensions --approve
neura
```

`install.ps1` copies repository-controlled extensions, theme, policy modules,
MCP configuration, keybinding changes, and launcher into live Pi harness.
Existing model and credential choices in `settings.json` are preserved unless
`-ForceSettings` is supplied. The installer also provisions Learn's separate
locked runtime with lifecycle scripts disabled and records the runtime lock receipt.
When Windows Terminal is available, it adds an isolated current-user `Neura`
profile fragment and a `Neura` Start-menu shortcut without editing `settings.json`.
Open that shortcut for the single-window image-backed launch. Running `neura`
inside an existing terminal stays in that window and uses the logo-only fallback.

Do not run installer against an important profile until you have reviewed
source and current blockers. Installation is not atomic and does not yet
provide automatic rollback. Track this in
[#21](https://github.com/Rajveerx11/neura/issues/21).

## Configure

Credentials belong in user environment variables or provider-managed stores,
never in this repository. The default MCP configuration uses reviewed HTTP(S)
endpoints only. Add a local MCP command only after pinning and manifesting its
absolute executable and dependency closure; project configuration is not a
trusted source of automatic executables.

Gmail requires `COMPOSIO_API_KEY`. Other optional servers remain disabled until
configured. Review [dependency policy](docs/DEPENDENCIES.md) before enabling any
server or extension.

## Verify

```powershell
npm ci --ignore-scripts
npm ci --prefix agent/neura --ignore-scripts
npm run typecheck
npm audit --audit-level=high
npm audit --prefix agent/neura --audit-level=high
powershell -NoProfile -File .\scripts\verify-secrets.ps1
powershell -NoProfile -File .\scripts\verify-secrets.tests.ps1
npm run test:accessibility
node scripts\tests\learn-browser.mjs
node scripts\verify-harness.mjs
node scripts\verify-sandbox.mjs
node scripts\check-docs.mjs
git diff --check
powershell -File .\install.ps1 -Check
```

`verify-harness.mjs` runs 17 isolated suites and loads all 18 extensions through
the checkout's Pi loader, including Learn's five nonbrowser suites. Browser
checks need Edge; sandbox replay needs WSL2/bubblewrap. `install.ps1 -Check`
checks live drift and Learn runtime provisioning without installing anything.
For focused commands, Linux coverage, and proof limits, see
[Verification](docs/VERIFICATION.md). Passing checks prove covered behavior only.

## Commands

| Command | Purpose |
|---|---|
| `/mode [plan|work|yolo|human-away|learn|next|status]` | Select or inspect operating mode |
| `/learn [status|hint|reveal|explain|deeper|example]` | Inspect or continue a Learn lesson |
| `/learn answer <text or SQL>` | Submit an exercise attempt; use `answer-helped` after assistance |
| `/learn [save|saved|resume <filename>|reset]` | Explicitly save, restore, or clear learning state |
| `/approvals` | Review Human Away requests |
| `/approvals audit` | Show recent approval decisions |
| `/health` | Inspect required readiness, optional integrations, runtime identity, and Pi drift in YOLO |
| `/ship` | Full proof in Work or YOLO; does not commit, push, or merge |
| `/undo` | Restore previous in-session checkpoint in YOLO |
| `/undo list` | List YOLO checkpoints |
| `/clip [answer|code]` | Copy latest answer or a code block |
| `/preset gpt|opus|qwen` | Switch model preset |
| `/remember <fact>` | Save one local memory fact in YOLO |
| `/memory` | Show local memory in YOLO |
| `/skill-doctor` | Find skills using unsupported tools in YOLO |
| `/dash` | Toggle Neura wordmark |
| `/notices` | Show persistent degraded-state notices |

## Repository map

```text
agent/extensions/   Pi lifecycle hooks, commands, tools, and UI
agent/neura/        Shared policy, learning, rendering, and locked document runtime
agent/themes/       Neura terminal theme
launcher/           Windows neura command
scripts/            Deterministic verification and security checks
scripts/tests/      Independent suites with temporary homes and synthetic state
docs/               Architecture, status, development, and release guidance
plans/              Historical design evidence, not current requirements
```

## Security and limitations

- YOLO is intentionally unsandboxed and can cause local or remote side effects.
- Plan containment is application-level, not an OS sandbox.
- Work combines application policy with isolated command execution; it is not
  a complete confidentiality boundary for all workspace searches.
- Learn's document parser has time/heap limits, not OS isolation. Native parser
  dependencies remain trusted; source-location checks do not prove a tutor's claim.
- Human Away Preview has unresolved transactional and resource-boundary work.
- Redaction is pattern-based and cannot guarantee detection of every secret.
- Optional providers, MCP servers, skills, and local tools expand trust
  boundary.
- Current production blockers are tracked in
  [Production readiness milestone](https://github.com/Rajveerx11/neura/milestone/1).

Report vulnerabilities through a private GitHub security advisory as described
in [SECURITY.md](SECURITY.md). Do not open a public exploit report.

## Documentation

- [Documentation index](docs/README.md)
- [Learn Mode](docs/LEARN_MODE.md)
- [Current status](docs/STATUS.md)
- [Open-source publication checklist](docs/OPEN_SOURCE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Development workflow](docs/DEVELOPMENT.md)
- [Verification suites and proof](docs/VERIFICATION.md)
- [Dependency policy](docs/DEPENDENCIES.md)
- [Learn document runtime and limits](docs/LEARN_DEPENDENCIES.md)
- [Production-readiness gates](docs/PRODUCTION_READINESS.md)
- [Release process](docs/RELEASING.md)
- [Changelog](docs/CHANGELOG.md)
- [Design system](DESIGN.md)
- [Historical plan index](plans/README.md)
- [Contributing](CONTRIBUTING.md)
- [Support](SUPPORT.md)
- [Governance](GOVERNANCE.md)

## Contributing

Issues and focused pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md)
and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) first. Security reports follow
[SECURITY.md](SECURITY.md), not public issue tracker.

## License

Neura is licensed under [Apache License 2.0](LICENSE). Copyright and attribution
information lives in [NOTICE](NOTICE).

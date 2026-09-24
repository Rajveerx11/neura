# Dependency policy and review

Pi/development source review: 2026-09-24 (Pi 0.87.1). Learn runtime review: 2026-09-07.
MCP lifecycle and automatic-execution review: 2026-09-13. Documentation
reconciled with source: 2026-09-13.

Neura uses exact runtime and development pins. `package-lock.json` is the
reproducible development graph. Pi-managed runtime extensions are pinned in
`agent/settings.json`; `install.ps1` merges those exact pins into the live
harness without replacing unrelated local packages or model choices.

Learn's document runtime has a separate exact manifest and lockfile under
`agent/neura/`. See [LEARN_DEPENDENCIES.md](LEARN_DEPENDENCIES.md) for six direct
pins, licenses, reviewed entry points, native/WASM trust, and parser limits.
Development setup needs both graphs:

```powershell
npm ci --ignore-scripts
npm ci --prefix agent/neura --ignore-scripts
```

The installer provisions the nested graph with scripts disabled and records a
lock receipt. It does not make installation atomic. Node 24.15+ is required for
Learn's SQLite authorizer; CI exercises 24.16.0.

## Reviewed runtime surface

| Package | Pin | Source and lifecycle review | Privileged behavior |
|---|---:|---|---|
| `@earendil-works/pi-coding-agent` | `0.87.1` | [Upstream release](https://github.com/earendil-works/pi/releases/tag/v0.87.1); 0.86–0.87 changelog and installed context/session/footer APIs reviewed. pi-ai, pi-tui, and pi-coding-agent manifests have build and `prepublishOnly` but no consumer install hook. Registry integrity and signatures verified. | Runs providers, tools, extensions, child processes, sessions, and filesystem operations with the host user's authority. |
| `@ollama/pi-web-search` | `0.0.5` | Published package contains only `index.ts`, README, and license; no dependencies or lifecycle scripts. Repository metadata is absent, so the shipped source was reviewed directly. | Sends search/fetch requests to local Ollama at `127.0.0.1:11434`; Ollama performs external web access. Direct fetch remains disabled in Plan. |
| `@spences10/pi-redact` | `0.0.14` | [Source](https://github.com/spences10/my-pi/tree/main/packages/pi-redact); no install hook. Registry signature verified. | Intercepts tool output before model context and performs local pattern-based redaction. |
| `@spences10/pi-lsp` | `0.0.44` | [Source](https://github.com/spences10/my-pi/tree/main/packages/pi-lsp); no install hook. Registry signature verified. | Starts language servers and reads project files after project-trust checks. |
| `pi-subagents` | `0.41.0` | [Source](https://github.com/nicobailon/pi-subagents); exposes a manual CLI installer but no npm install lifecycle hook. Registry signature verified. | Starts isolated Pi child processes and manages local delegation state. Human Away does not expose this tool. |
| `@spences10/pi-mcp` | `0.0.58` | [Source](https://github.com/spences10/my-pi/tree/main/packages/pi-mcp); no install hook. Registry signature verified. Its package extension is filtered out so Neura's owned wrapper controls lifecycle. | `/mcp connect` discovers configured tools only in YOLO; selected connected tools can reconnect on demand. Restricted modes neither start nor await MCP connections. |
| `@spences10/pi-context` | `0.1.15` | [Source](https://github.com/spences10/my-pi/tree/main/packages/pi-context); no install hook. Registry signature verified. | Writes a local SQLite context sidecar under the live harness. |

## Reviewed proof runner

Work and YOLO proof share the network-disabled WSL2 bubblewrap path. It requires
uv `0.12.11` and uses `--isolated --offline --no-config --no-index`; a
repository cannot provide uv configuration or trigger a download. The runtime
contract pins official Linux x86-64 archive SHA-256
`4ae93e0f148a18434cc094072547cec88912fc4a72b984183c7d0d0e9586cb5e`
and the extracted uv/uvx hashes. CPython `3.12.3` at `/usr/bin/python3.12` is
pinned by executable SHA-256
`e1efa562c2cc2e35521a5c9c9b9939921001ff8ca9708a13ef15ace68cc2ccd7`.
The inspected WSL distribution reports Ubuntu Noble
[`python3.12-minimal`](https://packages.ubuntu.com/noble-updates/python3.12-minimal)
`3.12.3-1ubuntu0.13` for `amd64`, built from source package `python3.12` at the
same version. Local APT policy records `noble-updates/main` and
`noble-security/main` as the candidate origins, and `dpkg -V` reported no
installed-package differences on 2026-09-13. That exact package tuple and the
stronger installed-binary SHA-256 are runtime requirements. The installed
version's `.deb` archive and detached signature were not retained locally, so
Neura does not claim independent archive-signature verification; any package,
version, architecture, or binary-digest mismatch makes proof unavailable.
The configured uv directory, interpreter, and exact five-wheel directory are
verified, mounted read-only, and exercised inside the sandbox with a fresh
local cache. The command passes the mounted interpreter through `--python` and pins
`proof-of-work-agent==0.2.0` and its complete runtime closure:
`cryptography==49.0.0`, `cffi==2.1.0`, `pycparser==3.0`, and `PyYAML==6.0.3`.

The reviewed [v0.2.0 source](https://github.com/Rajveerx11/proof-of-work/tree/v0.2.0)
resolves to commit `914e1b7e62acc4e24b767a9d61946cbf8808fb75`; its checked-in `uv.lock`
records the same closure and artifact hashes. PyPI publishes wheel SHA-256
`e1dc9a077eb2039eced85e9c2e78c85d6d3ffc7054559f7c4df044d940aae6c6` and
sdist SHA-256 `d34bb9f77d90431b6bcc94375031a38192ad76845c95efa30e46466d44cd541e`.
The Git tag and PyPI artifacts have no publisher signature or Trusted Publishing
attestation; that absence was reviewed and is recorded here rather than claimed
as verified. Exact pins, reviewed hashes, a read-only wheelhouse, network isolation,
and no host fallback are the compensating controls. Missing or wrong versions
degrade proof only; they do not weaken another mode or start a download.

Automatic Windows Git resolves only from the Git for Windows installation,
then must match `2.50.1.windows.1` and SHA-256
`c954fcc8e65a38450895ca65d308ecaee63f044d16494b5385faa5e036a3facb`
from the runtime contract. The reviewed executable has a valid Authenticode
signature from Johannes Schindelin (certificate thumbprint
`3EB14A3AEF84B7153E139397F0A49E2FAC662B0E`) and comes from the
[official release](https://github.com/git-for-windows/git/releases/tag/v2.50.1.windows.1).
CI reads the official portable archive URL and SHA-256
`c45a7dfa2bde34059f6dbd85f49a95d73d5aea29305f51b79595e56e4f323a3d` from
`runtime-contract.json`, verifies the download before extraction, then sets
`NEURA_GIT_EXECUTABLE`; the same executable version and hash checks still apply,
and workspace-contained overrides are rejected.

## Reviewed CI security tools

| Tool | Pin and integrity | Source and lifecycle review | Privileged behavior |
|---|---|---|---|
| Gitleaks CLI | `8.30.1`; Windows x64 archive SHA-256 `d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e` | [Official release](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1). CI downloads the exact archive, verifies its published digest, then extracts it. No installer or floating action tag runs. | Reads the complete Git history in CI. Findings are fully redacted; checkout credentials are removed before the scanner starts. |
| GitHub Actions | `actions/checkout` `v7.0.1` (`3d3c42e5aac5ba805825da76410c181273ba90b1`), `actions/setup-node` `v7.0.0` (`820762786026740c76f36085b0efc47a31fe5020`), and `actions/upload-artifact` `v7.0.1` (`043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`) | Official GitHub-maintained actions, pinned to immutable commits. Checkout and setup-node use the supported Node 24 action runtime. | Checkout reads repository history, setup-node provisions the pinned Node version and npm cache, and upload-artifact stores generated Plan evidence for seven days. |

## Development graph

`package.json` pins Pi `0.87.1`, Pi API/TUI types `0.87.1`, Playwright Core
`1.63.0`, axe-core `4.13.0`, Typebox `1.3.34`, TypeScript `7.0.2`, and Node types
`26.6.2`; it also pins `@spences10/pi-mcp` `0.0.58` so the owned lifecycle
wrapper runs against the reviewed package in tests. Installation uses
`npm ci --ignore-scripts` in CI. Playwright Core has
no install hook or bundled browser; verification launches the Microsoft Edge
already present on the Windows runner. Version `1.63.0` retains Node 20+ support; rollback restores the prior manifest and lockfile together. axe-core has no consumer install hook and
runs only against generated local Plan and Learn HTML. Browser contexts receive no
credentials or network capability. The exact-pinned official upload-artifact
action stores generated Plan screenshots and structured results for seven days.
Learn browser assertions also run in CI; the current artifact step is Plan-specific.

The 2026-09-24 root graph reports zero known high npm vulnerabilities; all 246
packages have verified registry signatures and 86 attestations. The Learn graph
reports zero known high vulnerabilities; all 21 packages have verified
signatures and 3 attestations.

Pi `0.83.0` was rejected for stable release because its locked `undici` and
`brace-expansion` versions had current moderate/high advisories. Pi `0.84.4`
passed Neura's offline live-startup smoke test, loader harness, typecheck,
dependency audit, signature audit, live drift check, and WSL2 sandbox replay.
That is historical evidence. Pi `0.87.1` passed the pinned development
loader harness and configured typecheck after review of canonical session,
context-edit, and footer API changes. Source, development APIs, and CI now
pin `0.87.1`; verify live installations separately. The installer does not
replace global Pi. Roll back the manifest, lockfile, runtime contract, and
live Neura files together rather than downgrading global Pi silently.

## Update policy

1. Change one direct pin at a time.
2. Review repository ownership, published files, dependency changes, and every
   lifecycle script before installation.
3. Install with scripts disabled when package operation does not require them.
4. Run `npm audit --audit-level=high` and `npm audit signatures` for the root
   graph and again with `--prefix agent/neura` for Learn's graph.
5. Run typecheck, harness verification, sandbox replay, docs validation, and the
   Windows live-drift check.
6. Record behavior, migration, and rollback in the changelog and release notes.

For a proof-runner update, review its source tag and full lockfile, update every
inline runtime pin and recorded hash together, verify the pinned WSL CPython,
then populate a dedicated WSL
wheelhouse and configure `NEURA_WSL_UV_DIR` plus
`NEURA_WSL_PROOF_WHEELHOUSE` during an authorized release rehearsal. Roll back
by restoring the previous constants
and source installation; in-session checkpoints are disposable temp copies and
need no migration. Optional MCP commands removed from the default configuration
must stay absent unless replaced by a reviewed HTTPS endpoint or a separately
pinned and manifested executable.

Never use `*`, `latest`, caret, or tilde ranges for Neura runtime packages.

Mode availability narrows package capability: Learn, Plan, Work, and Human Away
exclude MCP connection and tools; Learn and Human Away also exclude subagents,
while Learn excludes direct `web_fetch`, `grep`, and `find`. Merely installing an
extension does not authorize it in every mode.

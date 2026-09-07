# Dependency policy and review

Pi/development source review: 2026-09-03. Learn runtime review: 2026-09-07.
Documentation reconciled with merged source: 2026-09-07.

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
lock receipt. It does not make installation atomic. Node 24.10+ is required for
Learn's SQLite authorizer; CI exercises 24.16.0.

## Reviewed runtime surface

| Package | Pin | Source and lifecycle review | Privileged behavior |
|---|---:|---|---|
| `@earendil-works/pi-coding-agent` | `0.84.4` | [Upstream release](https://github.com/earendil-works/pi/releases/tag/v0.84.4); published manifest has build and `prepublishOnly`, but no consumer install hook. Registry integrity and signature verified. | Runs providers, tools, extensions, child processes, sessions, and filesystem operations with the host user's authority. |
| `@ollama/pi-web-search` | `0.0.5` | Published package contains only `index.ts`, README, and license; no dependencies or lifecycle scripts. Repository metadata is absent, so the shipped source was reviewed directly. | Sends search/fetch requests to local Ollama at `127.0.0.1:11434`; Ollama performs external web access. Direct fetch remains disabled in Plan. |
| `@spences10/pi-redact` | `0.0.14` | [Source](https://github.com/spences10/my-pi/tree/main/packages/pi-redact); no install hook. Registry signature verified. | Intercepts tool output before model context and performs local pattern-based redaction. |
| `@spences10/pi-lsp` | `0.0.44` | [Source](https://github.com/spences10/my-pi/tree/main/packages/pi-lsp); no install hook. Registry signature verified. | Starts language servers and reads project files after project-trust checks. |
| `pi-subagents` | `0.41.0` | [Source](https://github.com/nicobailon/pi-subagents); exposes a manual CLI installer but no npm install lifecycle hook. Registry signature verified. | Starts isolated Pi child processes and manages local delegation state. Human Away does not expose this tool. |
| `@spences10/pi-mcp` | `0.0.58` | [Source](https://github.com/spences10/my-pi/tree/main/packages/pi-mcp); no install hook. Registry signature verified. | Starts configured MCP processes or HTTP clients, filters child environment, and stores oversized responses through `pi-context`. Human Away removes MCP tools. |
| `@spences10/pi-context` | `0.1.15` | [Source](https://github.com/spences10/my-pi/tree/main/packages/pi-context); no install hook. Registry signature verified. | Writes a local SQLite context sidecar under the live harness. |

## Reviewed CI security tools

| Tool | Pin and integrity | Source and lifecycle review | Privileged behavior |
|---|---|---|---|
| Gitleaks CLI | `8.30.1`; Windows x64 archive SHA-256 `d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e` | [Official release](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1). CI downloads the exact archive, verifies its published digest, then extracts it. No installer or floating action tag runs. | Reads the complete Git history in CI. Findings are fully redacted; checkout credentials are removed before the scanner starts. |

## Development graph

`package.json` pins Pi `0.84.4`, Pi API/TUI types `0.84.4`, Playwright Core
`1.62.1`, axe-core `4.13.0`, Typebox `1.3.7`, TypeScript `7.0.2`, and Node types
`26.2.0`. Installation uses `npm ci --ignore-scripts` in CI. Playwright Core has
no install hook or bundled browser; verification launches the Microsoft Edge
already present on the Windows runner. axe-core has no consumer install hook and
runs only against generated local Plan and Learn HTML. Browser contexts receive no
credentials or network capability. The exact-pinned official
`actions/upload-artifact` commit `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`
stores generated Plan screenshots and structured results for seven days.
Learn browser assertions also run in CI; the current artifact step is Plan-specific.

The 2026-09-03 review found zero known npm vulnerabilities; all 251 audited
packages had verified registry signatures and 52 had attestations.

Pi `0.83.0` was rejected for stable release because its locked `undici` and
`brace-expansion` versions had current moderate/high advisories. Pi `0.84.4`
passed Neura's offline live-startup smoke test, loader harness, typecheck,
dependency audit, signature audit, live drift check, and WSL2 sandbox replay.
That is historical evidence, not a fresh live-drift result. Current source,
development APIs, and CI still pin `0.84.4`; verify live installations separately.

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

Never use `*`, `latest`, caret, or tilde ranges for Neura runtime packages.

Mode availability narrows package capability: Learn and Human Away exclude
subagent and MCP tools; Learn also excludes direct `web_fetch`, `grep`, and
`find`. Merely installing an extension does not authorize it in every mode.

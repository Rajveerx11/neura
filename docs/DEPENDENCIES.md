# Dependency policy and review

Pi/development source review: 2026-10-08 (Pi 1.1.0). Learn runtime review: 2026-09-07.
MCP lifecycle and automatic-execution review: 2026-09-13. Public-default
configuration review: 2026-09-15.

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
| `@earendil-works/pi-coding-agent` | `1.1.0` | [Upstream release](https://github.com/earendil-works/pi/releases/tag/v1.1.0); current SDK/CLI modifier selection, settlement/duration, loader/session, native MCP and nested/deferred APIs were reviewed and exercised. Eight coupled Earendil manifests have maintainer build/publish scripts, not consumer install hooks. Locked registry integrity and signatures were verified; native/WASM and full source equivalence remain bounded review limits. | Runs providers, tools, extensions, child processes, sessions, and filesystem operations with the host user's authority. Neura's launcher disables native MCP; indirect tools are YOLO-only. |
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

`package.json` pins Pi `1.1.0`, Pi API/TUI types `1.1.0`, Playwright Core
`1.63.0`, axe-core `4.13.0`, Typebox `1.3.34`, TypeScript `7.0.2`, and Node types
`26.6.4`; it also pins `@spences10/pi-mcp` `0.0.58` so the owned lifecycle
wrapper runs against the reviewed package in tests. Installation uses
`npm ci --ignore-scripts` in CI. Playwright Core has
no install hook or bundled browser; verification launches the Microsoft Edge
already present on the Windows runner. Version `1.63.0` retains Node 20+
support; rollback restores the prior manifest and lockfile together. axe-core
has no consumer install hook and runs only against generated local Plan and
Learn HTML. Browser contexts receive no
credentials or network capability. The exact-pinned official upload-artifact
action stores generated Plan screenshots and structured results for seven days.
Learn browser assertions also run in CI; the current artifact step is Plan-specific.

The historical 2026-09-24 root-graph review found zero known high npm
vulnerabilities; all 246 audited packages had verified registry signatures and
86 had attestations. The Learn graph found zero known high npm vulnerabilities; all 21 audited
packages had verified registry signatures and 3 had attestations.

### PR #94 scoped transitive refresh (2026-10-05)

The September evidence above is historical, not an audit of the PR #94 graph.
The fresh baseline reported three `brace-expansion` denial-of-service advisories:
[GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p)
(parser stack exhaustion, fixed in 5.0.10),
[GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7)
(nested-brace stack exhaustion, fixed in 5.0.11), and
[GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr)
(quadratic rewrite CPU consumption, fixed in 5.0.12). All three require at
least 5.0.12 to clear together; no audit threshold was lowered.

Only the root lock entry at
`node_modules/@earendil-works/pi-coding-agent/node_modules/brace-expansion`
changes from 5.0.9 to 5.0.12. The parent `minimatch` 10.2.6 already allows
`^5.0.8`; no override, direct pin, dependency, or other graph entry changes.
Pi stays 0.87.1 and the proof closure stays unchanged. The separate PR #88 owns
the Pi 1.0.3 upgrade, not this repair.

Source/release review compared the official
[v5.0.9...v5.0.12 diff](https://github.com/juliangruber/brace-expansion/compare/v5.0.9...v5.0.12)
and both npm tarballs. The official v5.0.12 tag resolves to
`f3410159d768f56c9d9f4511d3e1b46425fc1099`; no separate GitHub Release exists
for that tag (the release API returned 404). Source changes make comma parsing
iterative, replace array argument spreading with bounded-stack pushes, and add
1,000-level nesting and 1,000-rewrite limits, returning remaining input literally
when a limit is reached. The upstream regression additions cover deep nesting,
long comma-group chains, large comma arrays, bounded rewrites, and ordinary
expansion compatibility. Published ESM/CommonJS code and declarations carry
those same changes; other artifact differences are generated maps and the
manifest. Ownership remains `juliangruber/brace-expansion`, MIT; runtime
`balanced-match ^4.0.2`, Node `20 || >=22`, and package exports are unchanged.
Upstream also changes development-only lock entries and formatting CI; those
are not Neura graph changes. Lifecycle scripts remain maintainer build/test/
publish scripts (`prepare`, `pretest`, `presnap`, `preversion`, `postversion`,
`prepublishOnly`); only `format:check` was added. There is no consumer `preinstall`,
`install`, or `postinstall` hook. Neura installs with all scripts disabled.

The downloaded official 5.0.12 tarball's computed SHA-512 matches registry
metadata and the exact root lock integrity:
`sha512-YovQ3rzhaLMIrDjNDMkNS01tea93qhEhG5xy8f6+R0l+dw3Ki+5sCoIoI942iuLZTHWogWktgwVDhU09iNEimQ==`.
Registry metadata supplies signatures with key ID
`SHA256:DhQ8wR5APBvFHLF/+Tc+AYvPOdTpcIDqOhxsBHRwC7U`; fresh `npm audit signatures`
verified the installed root graph, including this artifact. Fresh independent
root/Learn `npm ci --ignore-scripts` and high-severity audits reported zero
known vulnerabilities (including lower severities). Root signature evidence is
221 verified registry signatures and 61 attestations; Learn has 21 signatures
and 3 attestations. These counts describe this Windows-resolved PR graph, not
the older September graph or every platform-optional package.

CI now runs `audit:all`, chaining dependency and signature audits with `&&`.
Release installs, policy, audit, and verification use separate fail-closed steps;
remaining multi-native tag, secret-scan, and installer steps check earlier exit
codes before proceeding. Runnable release regressions exercise successful and
failing audits and Windows native commands, including policy and audit failures
that cannot be overwritten by later success. This is source-only CI/dependency
repair, not a release, live install, policy change, or full proof PASS claim.
Rollback restores the prior lock entry and workflow/script changes together;
5.0.9 remains vulnerable and is not an acceptable security rollback target.

The earlier PR #88 Pi 1.0.3 graph was audited on 2026-10-05: root/Learn
reported zero known vulnerabilities, with 137/21 registry signatures and 42/3
attestations respectively. These are historical counts, not the final candidate's
review evidence. Pi 1.0.3 drops the consumer shrinkwrap and pins `brace-expansion` 5.0.12;
Neura still records its complete exact graph in `package-lock.json`. The three
Pi direct packages and the loader's resolved AI/TUI modules must agree with
`runtime-contract.json`. The actual resource-loader regression checks that
Neura's guarded `/mcp` replaces the built-in eager connector, while plain Pi
retains the built-in extension. The Neura launcher uses `--tui-mode regular`
to preserve the existing launch; it does not alter plain Pi defaults.
The upstream Azure provider rename requires affected users to migrate their own
provider configuration or sign in again; Neura does not rewrite credentials.

Pi `0.83.0` was rejected for stable release because its locked `undici` and
`brace-expansion` versions had current moderate/high advisories. Pi `0.84.4`
passed Neura's offline live-startup smoke test, loader harness, typecheck,
dependency audit, signature audit, live drift check, and WSL2 sandbox replay.
That is historical evidence. Pi `0.85.1` was source-reviewed from the installed
release and verified through Neura's loader harness, typecheck, dependency audit,
and full verification suite on 2026-09-15; a fresh live-drift result is recorded
separately. The September source, development APIs, and CI pinned `0.87.1`;
that is historical evidence, not the current `1.1.0` graph. The 0.87.0 canonical-session and context-edit changes
were reviewed against Neura's session, footer, and extension APIs; the complete
harness and configured typecheck passed on the exact 0.87.1 development graph.
The installer does not replace a user's global Pi. Rolling back requires
restoring the prior manifest, lockfile, runtime contract, and live Neura files
together; do not downgrade a newer global Pi silently.

### Pi 1.1.0 compatibility slice (2026-10-08)

Latest-stable discovery rejected the older `1.0.4` target, a Neura maintenance
compatibility defect rather than a flaky process test. The official lightweight
`v1.1.0` tag resolves to `abe508e1b89912adde45528136c3221eb69acdd7`.
The coding-agent artifact integrity is
`sha512-SeEi/4hdcHNgA9UWlefZl7ZZpm3dzi2OoxNjDHsBJ9o298LNOtbL4DGKgitlEj6uCTccvtw6f2hlCkTPVJ2RXg==`.

The three direct exact pins, runtime contract and managed manifest select `1.1.0`.
The complete root lock advances eight Earendil MIT packages: `chord`,
`pi-agent-core`, `pi-ai`, `pi-codemode`, `pi-coding-agent`, `pi-mcp`,
`pi-telemetry`, and `pi-tui`. Their published dependency declarations change
only intra-Earendil versions. Neura's actual resolved external versions and
integrities stay unchanged; npm removes only redundant identical
`balanced-match 4.0.4` and `brace-expansion 5.0.12` entries under coding-agent.
No upstream development lock was transplanted. Platform optionals, managed
extension pins, and the Learn manifest/lock remain unchanged.

All eight published manifests have no consumer install/prepare hooks; existing
esbuild `postinstall` stays disabled. Both private task graphs were provisioned
with locked `npm ci --ignore-scripts`. Root/Learn audits report zero known
vulnerabilities, with 137/21 verified registry signatures and 42/3 attestations.
Counts describe this Windows-resolved graph, not every platform optional.
These checks do not establish exhaustive native/WASM provenance or built-source
and Sigstore equivalence.

Current upstream SDK/extension/CLI/settings/security and relevant session/UI/MCP
references and examples were inspected. Real session tests execute registered
codemode/tool-search tools through Pi's agent pipeline with a local synthetic
stream: modifiers and reload cannot authorize restricted execution, while YOLO
and stock Pi still work. Native `--no-mcp`, override/load-failure denial and nested
deferred mediation remain enforced. Duration preserves parent linkage; normal
and aborted settlement are observed. Neura ignores aborted settlement before
starting automatic quick proof. Existing session leases, late-result rejection,
detector-only quick PASS and unavailable legacy full PASS remain unchanged.

Latest-Pi discovery, configured typecheck, all 18 isolated harness suites,
11 release checks, 35-file docs validation, focused process/unit/proof/integration,
UI/synthetic installer checks, audits and synthetic Edge browser assertions passed.
Fresh candidate review and remote CI are separate pending gates. No global/live
installation, clean-host upgrade or LSP result is claimed. Rollback restores
coordinated pins, lock, contract and managed hashes; never downgrade a newer Pi.

### Pi 1.0.4 readiness slice (2026-10-06)

The coordinated Pi coding-agent/API/TUI pins and root lock selected `1.0.4`.
Source tag `v1.0.4` resolves to `7c10bd4337495ee613f2224843ecdf349b80d1df`.
The coding-agent artifact integrity is
`sha512-+956nfMFHr5lDUVY/2Q4k+YzojzBuCaBXFgj0eSlXVGr7QVliVddKdc1Pz6yVg1dOlJQmb67doOVrlMsIcIdaw==`.

The resolved graph adds Earendil Works' MIT-licensed `chord`, `pi-codemode`,
`pi-mcp`, and `pi-agent-core` at `1.0.4`. Their published manifests/entry points
were inspected: Chord composes applications and depends on `esbuild 0.28.2`;
Codemode provides a QuickJS-WASI tool executor using `quickjs-wasi 3.6.2` (Vercel
Labs, MIT); MCP implements stdio/HTTP transport using `cross-spawn 7.0.6`.
The upstream graph also advances Anthropic/OpenAI clients. Exact resolutions,
registry URLs, and artifact integrity remain in `package-lock.json`; upstream
caret declarations do not authorize floating Neura installs. esbuild's consumer
`postinstall` is present and remains disabled by `npm ci --ignore-scripts`; it
must not be enabled merely to bootstrap Neura. This is not a complete source or
OS-isolation attestation of every upstream native/WASM component.

Fresh root/Learn audits report zero known vulnerabilities. The Windows-resolved
root graph has 137 verified registry signatures and 42 attestations; Learn has
21 signatures and 3 attestations. Historical September/PR #94 counts do not
describe this graph or every platform-optional package.

Native MCP normally connects enabled servers during startup, outside tool-call
mediation. Neura supplies Pi's enforced `--no-mcp` flag; its legacy wrapper still
owns explicit YOLO-only connections. Real-loader tests cover config/CLI overrides,
reload, and failed replacement loading with synthetic HTTP/stdio configurations;
a loopback stock-Pi positive control still connects. Registered deferred tools
remain callable when inactive, so deterministic hooks must mediate nested calls.
Real-session tests deny those calls in restricted modes and allow the YOLO
positive control. `codemode` and `tool_search` are explicitly YOLO-only pending
broader integration review. The supported launcher, not an arbitrary manually
set `NEURA` environment on stock Pi, owns the native startup barrier.

See [installer readiness](INSTALLER_READINESS.md) for remaining bootstrap and
clean-host gates. No live profile was changed by this source update.

## Optional Herdr integrations (not in the production runtime graph)

The Herdr workspace Calendar action is disabled unless the user explicitly sets
`NEURA_GCALCLI_EXECUTABLE` to an absolute path and
`NEURA_GCALCLI_SHA256` to its matching local file digest. The suggested manual
pin is `gcalcli==4.5.1`: [upstream tag v4.5.1](https://github.com/insanum/gcalcli/tree/v4.5.1)
resolves to `fd821e4f21232dbf5829775fcf85820969e19912`.
Its `pyproject.toml` uses `setuptools.build_meta`, provides a `gcalcli` CLI
entry point, and declares unpinned Google OAuth/API and other Python dependencies.
That metadata inspection is **not** a full source or transitive-artifact review.
Neura neither installs nor authenticates gcalcli; users must review the exact
executable and dependency closure before opting into this experimental action.
A user-supplied hash detects changes to that local executable but does not
prove its origin. The Herdr usage plugin likewise requires Herdr-provided
`HERDR_BIN_PATH` to be absolute and existing; it does not find a `herdr`
executable on a workspace-controlled PATH. The plugin itself is separately
linked by the user, not installed as a Neura default.

## Pi compatibility policy

Neura must work with the latest stable Pi after every upstream update. This is a
standing maintenance requirement, not a claim that untested versions already
work. Each new stable Pi release triggers a compatibility review and, where
needed, a Neura fix. Prereleases are outside this requirement unless explicitly
selected for testing.

1. Check the official package's latest stable version and upstream release notes;
   record the version and check date. Review API, TUI, loader, session, tool,
   dependency, and lifecycle-script changes relevant to Neura.
2. Treat Pi coding-agent, API/TUI packages, and Neura's runtime identity as one
   coordinated update: change their exact pins, root lockfile, runtime contract,
   release manifest/hashes, installer expectations, and CI version references
   together. Update managed runtime extensions only when compatibility requires
   it, with their own source review and exact pins.
3. Adapt Neura to changed APIs. Verify typecheck, the real Pi extension loader,
   mode/tool security boundaries (positive and negative tests), UI/keybindings,
   session lifecycle, sandbox replay, and dependency/signature audits. Rehearse
   clean install and upgrade on disposable Windows profiles, including rollback
   and `install.ps1 -Check`, before claiming live support.
4. Record the latest target, verified version, evidence, and any compatibility
   blocker in `docs/STATUS.md`; keep README, dependency review, and release notes
   consistent. Rerun required release checks before shipping.
5. Never downgrade the user's Pi to accommodate stale Neura pins, remove
   version/hash checks to hide incompatibility, or declare support from a version
   edit alone. If validation fails, report the blocker and fix Neura; live
   installation still requires explicit authorization and stopped Pi processes.

Exact pins make the validated graph reproducible; they must advance with stable
Pi releases rather than become a permanent ceiling. `latest` may be queried for
release discovery, never used as a runtime dependency specifier. On 2026-10-08,
npm latest and this checkout's exact pins agree at `1.1.0`. The bounded
`npm run check:pi-latest` command checks that agreement in CI and release gates;
the daily target-check workflow takes effect only after it reaches the default
branch. A successful target check alone does not establish runtime compatibility.

## Update policy

1. Change one independent direct pin at a time. Treat Pi runtime, AI, and TUI as
   one coupled upgrade; Dependabot groups those proposals, but cannot update
   Neura's contract, release hashes, migration documentation, or review evidence.
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

# Development

Develop against the checkout. The current entry point is `src/cli.ts`, using
Neura's own agent loop (`src/runtime.ts`) with Work, Learn and YOLO. Do not install into or develop against a Pi profile.
Development/testing remains limited to synthetic, non-sensitive data while the
[release and distribution gates](RELEASING.md) remain open.

## Setup

Use native Windows, PowerShell, Git and Node `24.15+` with npm. CI uses Node
`24.16.0`. Recorded local tests used `24.19.0`. Learn's first store creation
requires native Windows. Install both exact locked graphs without lifecycle scripts:

```powershell
npm ci --ignore-scripts
npm ci --prefix agent/neura --ignore-scripts
node src/cli.ts --help
node src/cli.ts --check
```

No global Pi, provider credential or live installation is needed for default
verification. Use a full-history clone for historical parity inventory checks.
Keep synthetic stores separate per checkout.

WSL2/bubblewrap and the selected distro's `/usr` tools are needed for actual
Work commands. Browser regression tests are no longer included. Offline proof additionally needs
the reviewed uv/CPython/wheel closure. Setup never provisions these silently.

## Change loop

1. Read [status](STATUS.md), affected callers and the relevant source.
2. Make a scoped change. Keep test files, fixtures and test-only runners outside
   this repository, as requested by the owner on 2026-11-17.
3. Run `npm run verify` and `git diff --check`. These check repository policy,
   source types, dependency boundaries and documentation. They run no runtime tests.
4. Validate changed behavior separately, including allowed and denied cases for
   security boundaries. Report actual results and missing regression coverage.

`node scripts/verify-harness.mjs` checks the test-file policy. Former suite
arguments fail explicitly. `npm test` fails to report unavailable tests.
The removed regression suites remain in Git history at
`1d4964a4f879fafc32d6fb74a0e575c7c77c0e5d`. They are not current test evidence.

## Invariants

- Preserve the approved logo, startup status and prompt. Keep ASCII, narrow,
  `TERM=dumb`, `NO_COLOR` and headless fallbacks.
- Expose Work, Learn and explicitly entered YOLO only. In Work and Learn, keep
  deterministic policy, canonical junction-aware containment, byte-bound edits
  and protected paths. Work commands keep fail-closed OS isolation; Learn parsers
  use application-level controls, not OS isolation.
- Project instructions, imported documents, saved profiles and reviewer output
  are untrusted data. None can grant authority.
- Keep Learn's dedicated tool allowlist, actual-answer provenance, marked stores,
  explicit save/resume, source reimport and stale-operation fences.
- Keep review/proof receipts candidate-bound and session-local. Full proof stays
  unavailable. Detector receipts retain `verified:false`.
- Preserve credentials, history, approvals, memory, vaults, legacy files and other
  agents' worktrees. Never print private state to diagnose a failure.

## Dependencies and CI

Root `package.json`/`package-lock.json` own the active provider graph.
`agent/neura/package.json` and its lock own document/OCR dependencies. New runtime
dependencies require exact pins, source/lifecycle review, documentation and tests.
Update the AI SDK provider packages together when contracts require it. Never add `@mastra/*`. See
[dependency policy](DEPENDENCIES.md) and the [closure review](MASTRA_V1_DEPENDENCIES.md).

```powershell
npm run audit:dependencies
npm run audit:signatures
powershell -NoProfile -File .\scripts\verify-secrets.ps1
```

CI retains required `harness` and `portable-proof` names for repository checks.
Secret/signature scans and CodeQL remain enabled. Runtime, browser, sandbox and
secret-scanner regression suites were removed. Green CI does not cover them. `verify:release` checks only
the licence gate, which now passes; other release gates remain open. Do not bypass a failure.

## Development launcher and rollback

Only install when the owner intentionally wants a launcher changed:

```powershell
powershell -NoProfile -File .\install.ps1 -Development
powershell -NoProfile -File .\install.ps1 -Check
```

The launcher points at mutable checkout source and requires an ASCII-only path.
`-Check` is read-only and does not authorize repair. No standalone Pi update or
profile import is involved. Exit Neura before source/launcher changes. Select a
known-good checkout or restore only a verified installer-owned launcher backup. Preserve private data and dirty work. See [installer readiness](INSTALLER_READINESS.md).

## Documentation ownership

| Change | Update |
| --- | --- |
| User-visible behavior | `README.md`, `docs/STATUS.md`, `docs/CHANGELOG.md` |
| Runtime or lifecycle | `docs/ARCHITECTURE.md`, `docs/MASTRA_V1.md` |
| Learn or document support | `docs/LEARN_MODE.md`, `docs/LEARN_DEPENDENCIES.md` |
| Documentation images | `assets/screenshots/README.md` for renderer/fixture provenance; label architecture artwork as a diagram and keep its editable SVG |
| Tests, review or proof | `docs/VERIFICATION.md` |
| Dependencies or distribution | `docs/DEPENDENCIES.md`, `docs/MASTRA_V1_DEPENDENCIES.md` |
| Install or release policy | `docs/INSTALLER_READINESS.md`, `docs/RELEASING.md` |

Update current guides and preserve dated historical evidence. Follow
[Contributing](../CONTRIBUTING.md) for PR requirements. Merging or publishing
requires separate explicit authorization.

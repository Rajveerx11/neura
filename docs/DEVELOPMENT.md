# Development

Develop against the checkout. The current entry point is `src/cli.ts`, using
Mastra with Work and Learn. Do not install into or develop against a Pi profile.
Development/testing remains limited to synthetic, non-sensitive data while the
[license/distribution gate](MASTRA_V1_DEPENDENCIES.md) remains open.

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
verification. Use a full-history clone: `parity-matrix` reads frozen commit
`3ebaac07c8320125bcc32478b5aa3865746a997c`. For a shallow clone, run
`git fetch --unshallow` before tests. Keep synthetic stores separate per checkout.

WSL2/bubblewrap and the selected distro's `/usr` tools are needed for actual
Work commands. Edge is needed for browser tests. Offline proof additionally needs
the reviewed uv/CPython/wheel closure. Setup never provisions these silently.

## Change loop

1. Read [status](STATUS.md), [repository rules](../AGENTS.md), affected callers
   and the relevant tests. Current source and [parity](PARITY_MATRIX.md) outrank
   historical plans and extension fixtures.
2. Make a scoped change. Add meaningful regression coverage for nontrivial logic. Security boundaries require allowed and denied cases. Active Node tests live
   in `tests/v1-*.test.ts`. Retained shared-service tests live in `scripts/tests/`.
3. Run a focused suite while editing, then the required repository checks:

   ```powershell
   node scripts/verify-harness.mjs --suite work-tools
   npm run verify
   git diff --check
   ```

4. Run separate browser, configured-host sandbox or dependency checks when the
   change reaches those boundaries. [Verification](VERIFICATION.md) lists them.
5. Inspect the complete diff for unrelated edits and private data. Report actual
   results, skipped checks and limitations. A green local suite is not CI or release approval.

The active runner defines 23 suites, including `acp` and `yolo`, in `scripts/verify-harness.mjs`.
Unknown suite names fail. There is no active `test:changed` or `test:accessibility` npm
script. Historical Pi runners remain separate and do not certify Mastra parity.

## Invariants

- Preserve the approved logo, startup status and prompt. Keep ASCII, narrow,
  `TERM=dumb`, `NO_COLOR` and headless fallbacks.
- Expose Work and Learn only. Keep deterministic policy, canonical junction-aware
  containment, byte-bound edits, protected paths and fail-closed isolation.
- Project instructions, imported documents, saved profiles and reviewer output
  are untrusted data. None can grant authority.
- Keep Learn's dedicated tool allowlist, actual-answer provenance, marked stores,
  explicit save/resume, source reimport and stale-operation fences.
- Keep review/proof receipts candidate-bound and session-local. Full proof stays
  unavailable. Detector receipts retain `verified:false`.
- Preserve credentials, history, approvals, memory, vaults, legacy files and other
  agents' worktrees. Never print private state to diagnose a failure.

## Dependencies and CI

Root `package.json`/`package-lock.json` own the active Mastra/provider graph.
`agent/neura/package.json` and its lock own document/OCR dependencies. New runtime
dependencies require exact pins, source/lifecycle review, documentation and tests.
Update the Mastra/AI SDK model stack together when contracts require it. See
[dependency policy](DEPENDENCIES.md) and the [closure review](MASTRA_V1_DEPENDENCIES.md).

```powershell
npm run audit:dependencies
npm run audit:signatures
powershell -NoProfile -File .\scripts\verify-secrets.ps1
powershell -NoProfile -File .\scripts\verify-secrets.tests.ps1
```

CI retains required `harness` and `portable-proof` checks, with Windows full
verification and Ubuntu portable contracts. Secret/signature checks, CodeQL and
Learn browser checks remain separate evidence. `verify:release` intentionally
fails while distribution approval is unresolved. Do not bypass it.

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

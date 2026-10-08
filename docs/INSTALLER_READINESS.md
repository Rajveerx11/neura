# Neura installer readiness

Updated: 2026-10-08. Scope: **Neura only**, inspired by Pi/Hermes installation
patterns. This is source-only preparation, not a published installer, live
installation, or production-readiness claim. Extend `install.ps1` and
`agent/neura/runtime-install.mjs`; do not build a second activation engine.

## First implemented slice

- Exact Pi coding-agent/API/TUI pins, root lockfile, runtime contract, and managed
  manifest now target stable `1.1.0`. Dependency review is in
  [DEPENDENCIES.md](DEPENDENCIES.md#pi-110-compatibility-slice-2026-10-08).
- Neura's launcher combines `--no-mcp` with `--tui-mode regular` to stop native startup connections even
  when configuration or explicit builtin selection would otherwise enable them.
  The existing explicit YOLO-only MCP wrapper remains in place. `codemode` and
  `tool_search` are denied outside YOLO; nested deferred calls retain policy hooks.
- `install.ps1` and `-Check` share prerequisite checks. Node is checked before
  Pi/npm. Missing commands, native failures, malformed/multiline versions, old
  Node, and Pi mismatches fail before staging. Newer Pi is never offered a
  downgrade; health uses the same no-downgrade policy.
- `npm run check:pi-latest` performs bounded public-registry discovery without
  installation. CI/release gates fail on stale targets or unavailable evidence.
  A daily target-check workflow is prepared, but is not active until published
  to the default branch. This detects lag; it does not automatically fix Neura.
- Draft-release source packaging now includes a Windows-friendly ZIP and its
  SHA-256 alongside the existing tarball and SBOMs. These are source artifacts,
  not self-contained runtime bundles. No new artifact has been published.
- Existing logo, theme, working/mode animation, and Terminal fragment remain
  managed resources. The logo-only launch and plain-Pi boundary are preserved.

## Before a one-step installer can ship

| Gate | Remaining work |
|---|---|
| Dependency bootstrap | Add reviewed exact Node/npm and host runtime artifacts with URLs, platform/architecture, integrity, and ownership receipts. Install missing prerequisites without replacing an unowned or newer installation. Pi's locked graph and Neura runtime packages must be installed without a separate manual extension-update step. Current installer still requires prerequisites already installed. |
| WSL execution setup | Detect/install WSL2 with explicit elevation/reboot handling and resumable setup; provision bubblewrap and reviewed uv/CPython/offline wheels. Verify package and executable hashes against the contract. Never silently substitute a newer binary or fall back to host execution. |
| Artifact delivery | Choose the distribution channel and trust/authenticity mechanism; verify a versioned archive before extracting and executing it. A checksum downloaded from the same mutable origin is not an independent publisher signature. The bootstrap must work without a repository checkout or Node already installed. |
| Profile consistency | Reconcile hardcoded `~/.pi/agent` consumers before using another Neura profile root. Preserve credentials, sessions, learning data, approvals, memory, and user-owned extensions; do not stage or publish them. |
| Cross-component recovery | Existing recovery covers managed files and staged Learn modules. Extend evidence to dependency activation, settings, PATH, launchers, Terminal resources, interruption, ownership, and path swaps. Do not describe the current installation as atomic. |
| Installer presentation | Add bounded terminal-native logo/progress output, plain/non-TTY fallback, reduced motion, and cancellation cleanup. Report actual stages; do not disguise failures with animation or invent completion percentages. |
| Clean-host rehearsal | Exercise fresh install, repeat install, upgrade, interruption, recovery, rollback, junction rejection, missing network/artifacts, and newer Pi on disposable Windows machines. Do not rehearse against the owner's live profile without explicit authorization. |
| Release evidence | Run typecheck, all suites, browser/WSL checks, audits/signatures, docs, independent review, and required CI on a clean candidate. Record failures and remaining limitations; retain experimental/Human Away preview labels. |

## Current candidate validation (2026-10-08)

- Exact Pi `1.1.0` configured typecheck, all 18 isolated harness suites,
  11 release checks and 35-file docs validation passed, including focused unit,
  integration, proof, UI and synthetic installer checks. Real agent-pipeline calls remain denied
  in all four restricted modes after modifier selection/reload; real codemode,
  tool search, nested calls and native MCP retain YOLO/stock-Pi positive controls.
  Duration/parent linkage and normal/aborted settlement were exercised with a
  local synthetic stream, not provider calls. Aborted settlement starts no quick proof.
- Latest-Pi discovery, both dependency/signature audits, and synthetic Plan/Learn
  Edge browser assertions passed. Plan's first two wrapper commands failed on
  temporary-profile cleanup after passing viewport assertions; the environment-only
  parent-owned cleanup invocation then passed after observing direct child exit.
  This is not physical Edge descendant-drain or live-profile evidence.
- Fresh review and new-head required CI remain pending; old PR98 `1.0.4` review
  and portable CI do not certify this candidate. No live installation/drift,
  clean-host bootstrap, TypeScript LSP or full proof PASS is claimed.

## Historical repository validation (2026-10-06)

- Configured typecheck and all 18 `verify-harness` suites passed, including the
  real Pi loader/session fixture, managed-file installer recovery, and Learn
  end-to-end checks using the shared prerequisite validation path.
- Docs, release-contract tests, latest-Pi discovery (`1.0.4`), and `git diff --check`
  passed. Root/Learn vulnerability audits and signature verification passed.
- These checks ran in the isolated managed worktree integrating PR #88 with
  main, not the dirty original checkout. The final 36-file candidate received
  independent review with no actionable findings. Previous mixed-checkout
  review evidence does not attest this candidate. Required remote CI is tracked
  on [PR #88](https://github.com/Rajveerx11/neura/pull/88), not established by local review.
- CodeRabbit completed that 36-file scope with two unverified suggestions,
  not a clean review. Both were independently assessed as non-actionable:
  the minor Git-normalization suggestion would broaden malformed-output
  acceptance without a rejected supported Windows format; the major suggestion
  to skip latest-Pi checks on PRs conflicts with the standing fail-closed policy.
  The documented registry-availability/moving-target tradeoff remains deliberate.
- Plan accessibility (two viewports) and Learn's desktop/mobile Edge checks
  passed with synthetic homes and temporary browser profiles using the already
  installed browser. The existing WSL sandbox replay passed with a synthetic
  workspace/home; no browser or WSL provisioning was performed. This is not a
  fresh-device bootstrap or reviewed proof-runtime rehearsal.
- TypeScript LSP was unavailable (`typescript-language-server` missing); the
  configured compiler check passed instead. No LSP success is claimed.

## Evidence boundaries

Synthetic installer tests already exercise managed-file upgrade, tampering,
rollback, and interrupted activation/recovery. New tests cover prerequisite
validation and Pi 1.x real-loader/session security seams using synthetic homes,
loopback HTTP, and a stdio-start marker; no model/provider calls are made.
They do not prove a clean device can bootstrap every dependency or that the
complete live installation is atomic.

The owner's live profile and source/live drift were not inspected in this
isolated preparation. Previous device drift evidence is historical, not a
check of this candidate, and never permission to sync or install. No live Neura/Pi
installation, WSL provisioning, tag, or release is part of this slice. Source
commits and PR delivery follow the owner's separate explicit authorization. The proof runner's full verified PASS
remains unavailable independently of these repository checks.

Track the remaining installer boundary in
[issue #21](https://github.com/Rajveerx11/neura/issues/21) and the overall gates in
[STATUS.md](STATUS.md), [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md), and
[RELEASING.md](RELEASING.md).

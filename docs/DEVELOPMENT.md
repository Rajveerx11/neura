# Development

## Source of truth

Edit `C:\Neura` first. Do not develop against `~/.pi/agent/` and copy changes
back later. The live harness is an installation target, not source.

## Prerequisites

- Windows PowerShell.
- Node.js and npm.
- Git.
- Pi `0.83.0` for the current release candidate.
- `uvx` for proof-of-work.

## Change loop

1. Read [STATUS.md](STATUS.md) and relevant source.
2. Make the smallest complete change.
3. Add positive and negative regression coverage to
   `scripts/verify-harness.mjs` when behavior changes.
4. Run:

   ```powershell
   node scripts\verify-harness.mjs
   node scripts\check-docs.mjs
   git diff --check
   ```

5. Review `git diff` for unrelated files and secrets.
6. Install only when live validation is needed:

   ```powershell
   powershell -File .\install.ps1
   powershell -File .\install.ps1 -Check
   ```

7. Commit and push only after explicit approval or the active workflow grants it.

## Required invariants

- Preserve the logo-only launch.
- Every Neura-specific extension must return early when `NEURA` is absent.
- Plan must remain read-only except for `publish_plan`.
- Filesystem decisions must use canonical, junction-aware containment.
- Unknown or ambiguous security actions must not gain permission from model text.
- Never place credentials, raw authorization headers, or private memory in source,
  tests, plans, logs, screenshots, or approval records.
- UI widgets must remain within ten lines and fit supported widths.
- Plain Pi must keep its normal theme and behavior.

## Verification scope

`scripts/verify-harness.mjs` is the current executable specification. It loads
every extension through Pi's real loader. A passing harness proves covered
behavior only; it does not prove OS isolation or complete policy coverage.

`install.ps1 -Check` compares repository and live files. Text comparison ignores
line-ending and final-newline differences but still reports semantic drift.

## Dependencies

Runtime packages are declared in `agent/settings.json`. New packages require:

1. exact version pin;
2. source and lifecycle-script review;
3. documented network, process, and filesystem behavior;
4. deterministic regression coverage;
5. changelog entry.

Current unpinned packages are tracked as a release blocker in
[STATUS.md](STATUS.md).

## Documentation ownership

| Change | Update |
|---|---|
| User-visible behavior | `README.md`, `docs/STATUS.md`, `docs/CHANGELOG.md` |
| Architecture or lifecycle | `docs/ARCHITECTURE.md` |
| Security boundary | `SECURITY.md`, `docs/STATUS.md`, tests |
| Release process | `VERSION`, release notes, `docs/RELEASING.md` |
| Visual system | `DESIGN.md` |
| Historical plan state | `plans/README.md` |

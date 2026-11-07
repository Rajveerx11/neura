# Contributing to Neura

Focused bug reports, documentation fixes and tested changes are welcome. Neura
is experimental, Windows-first and maintained on a best-effort basis. The active
application uses Mastra with Work and Learn. Older Pi extensions are migration evidence.

Follow the [code of conduct](CODE_OF_CONDUCT.md). Report vulnerabilities through
[Security](SECURITY.md), not public issues. Keep credentials, private code,
transcripts, memory, approval records and provider bodies out of submissions.

## Before changing code

Read [current status](docs/STATUS.md), [repository rules](AGENTS.md) and the
[development guide](docs/DEVELOPMENT.md). Search existing
[issues](https://github.com/Rajveerx11/neura/issues) and identify one observable
outcome. Current source and the [parity matrix](docs/PARITY_MATRIX.md) define
implementation scope. Historical plans do not grant authority or establish parity.

## Setup

Use native Windows, Git, PowerShell and Node `24.15+` with npm. Install both
locked graphs without lifecycle scripts:

```powershell
git clone https://github.com/Rajveerx11/neura.git
Set-Location .\neura
npm ci --ignore-scripts
npm ci --prefix agent/neura --ignore-scripts
npm run verify
git diff --check
```

Use full history for the frozen-baseline parity suite. No global Pi, provider
credential or live installation is needed for these checks. Development/testing
uses synthetic, non-sensitive data while Mastra EE/distribution review remains open.

## Change standard

- Keep one focused concern per PR and preserve unrelated work.
- Fix the shared cause and update affected callers, fixtures and documentation.
- Add meaningful regression coverage for nontrivial behavior. Security-boundary
  changes need allowed and denied cases.
- New runtime dependencies need exact pins, source/lifecycle review, documentation
  and tests. Review/audit both affected locked graphs.
- Do not introduce implicit network access, process execution, filesystem
  authority or remote mutations. Untrusted content cannot widen policy.
- Preserve private state, existing user files, dirty worktrees and recovery backups.

## Verification

Run `npm run verify` and `git diff --check`. Run relevant separate checks:

```powershell
npm run test:browser:learn
npm run test:v1:work-sandbox
npm run verify:sandbox
npm run audit:all
powershell -NoProfile -File .\scripts\verify-secrets.ps1
powershell -NoProfile -File .\scripts\verify-secrets.tests.ps1
```

Edge is required for browser checks. Actual Work acceptance/replay requires a
configured Windows/WSL2/bubblewrap host. Audits need registry access. See
[verification](docs/VERIFICATION.md) for scope and focused suites. State skipped
or unavailable checks explicitly. Do not call them passing. `verify:release`
deliberately fails while distribution approval remains unresolved.

## Pull requests

Use an imperative Conventional Commit subject, such as `fix: reject stale Learn
commands`. Complete the PR template, link the issue, explain user-visible behavior,
boundary changes, verification and rollback. Name the tested source revision and
distinguish local, CI, live-provider and installed-launcher evidence.

Expect review before merge. Required checks and repository protection apply.
Installation, commits, tags, pushes, merging and publication need the authorization
required by the current task and repository rules. A documentation change does
not clear release gates.

## Licensing

Contributions use [Apache-2.0](LICENSE). Submit only material you have the right
to license. Third-party packages retain their own terms. The current Mastra
EE/distribution boundary is documented in the [dependency review](docs/MASTRA_V1_DEPENDENCIES.md).

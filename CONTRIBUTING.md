# Contributing to Neura

Neura welcomes focused bug reports, documentation fixes, tests, and pull
requests. Project remains experimental, Windows-first, and maintained on a
best-effort basis.

By participating, you agree to [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
Vulnerabilities and credentials must follow [SECURITY.md](SECURITY.md), not
public issues.

## Before opening an issue

1. Search existing [issues](https://github.com/Rajveerx11/neura/issues).
2. Read [current status](docs/STATUS.md) and
   [known blockers](docs/PRODUCTION_READINESS.md).
3. Remove credentials, private paths, transcripts, memory, approval data, and
   provider responses from logs or screenshots.
4. Use a GitHub issue form and include smallest safe reproduction available.

Support questions belong under [SUPPORT.md](SUPPORT.md). The issue tracker is
for reproducible defects and scoped proposals.

## Development setup

Use Node 24.15+ (CI: 24.16.0). Install both locked graphs; a global Pi or live
harness installation is not required for development tests.

```powershell
git clone https://github.com/Rajveerx11/neura.git
Set-Location .\neura
npm ci --ignore-scripts
npm ci --prefix agent/neura --ignore-scripts
npm run verify
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for full workflow and platform
requirements. Do not install a development checkout into live Pi profile unless
live validation is necessary and intentional.

## Change standard

- Keep one focused concern per pull request.
- Fix root cause, not only visible symptom.
- Add regression tests for behavior changes.
- Add positive and negative tests for policy or trust-boundary changes.
- Do not add floating or unreviewed dependencies.
- Do not add hidden network, process, filesystem, or remote mutation.
- Update current docs and changelog when behavior changes.
- Treat `plans/` as historical evidence, not current requirements.
- Preserve unrelated work.

## Required verification

```powershell
npm run typecheck
powershell -NoProfile -File .\scripts\verify-secrets.ps1
powershell -NoProfile -File .\scripts\verify-secrets.tests.ps1
npm run test:accessibility
node scripts\tests\learn-browser.mjs
node scripts\verify-harness.mjs
node scripts\verify-sandbox.mjs
node scripts\check-docs.mjs
git diff --check
```

Browser checks need Edge; `verify-sandbox.mjs` needs WSL2 and bubblewrap.
See [verification guide](docs/VERIFICATION.md) for focused suites and portable
CI coverage. `npm run test:changed` helps iteration but does not replace required
checks. If a check cannot run, state why and do not claim it passed.

## Pull requests

- Use an imperative Conventional Commit subject, for example
  `fix: enforce Plan filesystem containment`.
- Complete pull request template.
- Link relevant issue.
- Describe user-visible behavior, trust-boundary impact, test evidence, and
  rollback.
- Keep generated or personal state out of commit.
- Expect review before merge. Maintainer may ask to split broad changes.

## Licensing

Contributions are accepted under [Apache License 2.0](LICENSE). By submitting a
contribution, you confirm you have right to license it to project under those
terms.

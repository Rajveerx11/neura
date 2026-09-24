# Development

## Source of truth

Edit repository checkout first. Do not develop against `~/.pi/agent/` and copy
changes back later. Live harness is an installation target, not source.

## Prerequisites

- Current supported Windows and PowerShell.
- Node.js 24.15+ and npm; CI uses 24.16.0.
- Git.
- Pi `0.87.1` for current `main`.
- uv/`uvx` `0.12.11` and CPython `3.12.3` at the runtime-contract path; set
  `NEURA_WSL_UV_DIR` to the reviewed WSL binary directory and
  `NEURA_WSL_PROOF_WHEELHOUSE` to the five hash-verified wheels.
- WSL2/bubblewrap for Work execution/proof and the live sandbox replay.
- Microsoft Edge for Plan and Learn browser checks.

## Install development dependencies

```powershell
npm ci --ignore-scripts
npm ci --prefix agent/neura --ignore-scripts
```

The root graph supplies pinned development tools and Pi's loader. The nested
graph supplies Learn's PDF/PPTX/OCR runtime. Tests need no global Pi, model
credentials, or live harness installation. Do not share generated learning data
or approval state between worktrees.

## Change loop

1. Read [STATUS.md](STATUS.md) and relevant source.
2. Make the smallest complete change.
3. Add meaningful regression coverage to the relevant `scripts/tests/` suite;
   security-boundary changes require positive and negative cases. Register new
   suites in `scripts/test-suites.mjs`.
4. Run:

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

5. Review `git diff` for unrelated files and secrets.
6. Install only when live validation is needed and the owner explicitly authorizes it:

   ```powershell
   powershell -File .\install.ps1
   powershell -File .\install.ps1 -Check
   ```

7. Open a focused pull request with exact verification evidence.

## Required invariants

- Preserve the image-backed launch and its logo-only fallback.
- Every Neura-specific extension must return early when `NEURA` is absent.
- Plan must remain read-only except for `publish_plan`.
- Filesystem decisions must use canonical, junction-aware containment.
- Unknown or ambiguous security actions must not gain permission from model text.
- Never place credentials, raw authorization headers, or private memory in source,
  tests, plans, logs, screenshots, or approval records.
- UI widgets must remain within ten lines and fit supported widths.
- Plain Pi must keep its normal theme and behavior.
- Work is default. YOLO transitions always require fresh interactive confirmation.
- Learn permits only its bounded tools; parsing, exercises, and background hooks
  must not introduce generic writes, shell access, or private-state reads.
- Session replacement must pause tools until prior operations drain; stale proof
  results cannot earn receipts for a new session.

## Verification scope

`scripts/verify-harness.mjs` launches 18 isolated suites, including six Learn
suites, and loads all 18 extensions through the checkout's Pi loader. See
[VERIFICATION.md](VERIFICATION.md) for focused commands, temporary-home
isolation, seeded fuzzing, race/crash cases, and Linux coverage.

Use `npm run test:changed` during iteration; documentation-only changes select
no runtime suites and still need a separate docs check. A passing harness proves
covered behavior, not OS isolation or complete policy coverage. Browser and
live WSL replay checks remain separate; report unavailable prerequisites honestly.

`install.ps1 -Check` compares repository and live files. Text comparison ignores
line-ending and final-newline differences but still reports semantic drift.
It also checks the actual sandboxed WSL proof runtime, Learn runtime
provisioning, and its lock receipt. Drift is not
permission to install. Docs may describe unreleased merged main while an older
working checkout or live install still differs; record the tested revision.

## Dependencies

Pi-managed runtime packages are declared in `agent/settings.json`; Learn uses
`agent/neura/package.json` and its own lockfile. New packages require:

1. exact version pin;
2. source and lifecycle-script review;
3. documented network, process, and filesystem behavior;
4. deterministic regression coverage;
5. changelog entry.

Executable dependency and provenance gaps are tracked in
[PRODUCTION_READINESS.md](PRODUCTION_READINESS.md). Reviewed pins, privileged
behavior, and the update process live in [DEPENDENCIES.md](DEPENDENCIES.md).
Document parser source review and limits live in
[LEARN_DEPENDENCIES.md](LEARN_DEPENDENCIES.md). Audit both dependency graphs.

## Production issue closure

A production-readiness issue closes only when its acceptance criteria, negative
tests, integration evidence, migration, rollback, and documentation are present.
Use [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) as the durable gate and
GitHub issue [#31](https://github.com/Rajveerx11/neura/issues/31) as the live
delivery order.

## Public contribution safety

- Reproduce security-sensitive bugs in a disposable repository.
- Redact usernames, paths, repository content, tokens, provider payloads,
  transcripts, memory, and approval records.
- Fork pull requests run against public code. They must not receive repository
  secrets or privileged tokens.
- Maintainer-only live-install checks must never run against an important user
  profile.
- Follow [CONTRIBUTING.md](../CONTRIBUTING.md) and
  [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md).

## Documentation ownership

| Change | Update |
|---|---|
| User-visible behavior | `README.md`, `docs/STATUS.md`, `docs/CHANGELOG.md` |
| Architecture or lifecycle | `docs/ARCHITECTURE.md` |
| Learning behavior or document support | `docs/LEARN_MODE.md`, `docs/LEARN_DEPENDENCIES.md`, `README.md` |
| Suites, proof, or test isolation | `docs/VERIFICATION.md` |
| Dependency or installer provisioning | `docs/DEPENDENCIES.md`, relevant runtime review, setup instructions |
| Security boundary | `SECURITY.md`, `docs/STATUS.md`, tests |
| Production gate or priority | `docs/PRODUCTION_READINESS.md`, GitHub roadmap |
| Release process | `docs/RELEASING.md`; change `VERSION` and release notes only for an authorized release |
| Visual system | `DESIGN.md` |
| Historical plan state | `plans/README.md` |
| Documentation navigation | `docs/README.md`, README documentation links |

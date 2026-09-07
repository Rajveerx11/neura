## Change

<!-- Exact behavior changed. -->

## Why

<!-- Root cause or repeated need. -->

## Related issue

<!-- Use "Closes #123" when merge should close an issue. -->

## Verification

- [ ] `node scripts\verify-harness.mjs`
- [ ] `npm run typecheck`
- [ ] `npm run test:accessibility`
- [ ] `node scripts\tests\learn-browser.mjs` (or reason not relevant/available)
- [ ] `node scripts\verify-sandbox.mjs` (or reason not run)
- [ ] `node scripts\check-docs.mjs`
- [ ] `git diff --check`
- [ ] Security-boundary changes include negative tests
- [ ] Verification names the source commit and distinguishes local checks, CI, and live-install evidence
- [ ] Dependency changes review and audit both affected lockfile graphs
- [ ] Documentation and changelog updated
- [ ] No secrets, private memory, sessions, or approval logs included
- [ ] Contribution follows `CODE_OF_CONDUCT.md` and `CONTRIBUTING.md`

## Risk and rollback

<!-- Trust boundary, external effect, compatibility risk, and exact rollback. -->

## Change

<!-- Exact behavior changed. -->

## Why

<!-- Root cause or repeated need. -->

## Related issue

<!-- Use "Closes #123" when merge should close an issue. -->

## Verification

- [ ] `node scripts\verify-harness.mjs`
- [ ] `npm run typecheck`
- [ ] `npm run check:pi-free`
- [ ] `node scripts\check-docs.mjs`
- [ ] `git diff --check`
- [ ] Security-boundary changes include allowed and denied checks outside this repository
- [ ] No test sources, fixtures or test-only runners included; unavailable runtime coverage stated
- [ ] Verification names the source commit and distinguishes local checks, CI, and live-install evidence
- [ ] Dependency changes review and audit both affected lockfile graphs
- [ ] Documentation and changelog updated
- [ ] Active Work/Learn scope distinguished from historical Pi behavior; release/license gates preserved
- [ ] No secrets, private memory, sessions, or approval logs included
- [ ] Contribution follows `CODE_OF_CONDUCT.md` and `CONTRIBUTING.md`

## Risk and rollback

<!-- Trust boundary, external effect, compatibility risk, and exact rollback. -->

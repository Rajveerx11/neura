# Releasing Neura

## Version policy

Neura uses semantic versions:

- patch: fixes with no intended capability expansion;
- minor: new user-visible capability or mode behavior;
- major: incompatible configuration, policy, or installation change;
- `-rc.N`: release candidate that still has named gates.

`VERSION` is the machine-readable source. Changelog and release-note filenames
must match it.

## Stable-release gate

All items must pass:

- [ ] `docs/STATUS.md` says stable-ready and has no required stable blockers.
- [ ] `node scripts\verify-harness.mjs` passes.
- [ ] `node scripts\verify-sandbox.mjs` passes on the release workstation.
- [ ] `npm run typecheck`, `npm audit --audit-level=high`, and
      `npm audit signatures` pass from a clean lockfile install.
- [ ] `node scripts\check-docs.mjs` passes.
- [ ] Windows CI passes on the release commit.
- [ ] `git diff --check` passes.
- [ ] `powershell -File .\install.ps1 -Check` passes after an intentional live sync.
- [ ] Pi and every runtime package are pinned and audited.
- [ ] Approvals, redaction, and Gmail policy meet the gates in `STATUS.md`.
- [ ] No credential, private memory, approval audit, session file, or local path secret is tracked.
- [ ] Release notes state user-visible changes, limits, migration, verification, and rollback.
- [ ] Worktree is clean and local `main` matches `origin/main`.

Human Away expansion also requires the separate sandbox and adversarial-replay
gates in [STATUS.md](STATUS.md).

## Release commands

Run only after the checklist passes and release is approved:

```powershell
$version = (Get-Content .\VERSION -Raw).Trim()
git tag -a "v$version" -m "Neura v$version"
git push origin main
git push origin "v$version"
```

Create the GitHub release from `docs/releases/v$version.md`. Do not tag an RC as
stable or describe preview boundaries as production-safe.

## Rollback

1. Stop Neura and any active external automation.
2. Check out the previous known-good tag in a separate worktree.
3. Run its verifier.
4. Install that tag with `install.ps1`.
5. Run `install.ps1 -Check`.
6. Record the rollback reason in the next changelog entry.

Do not rewrite shared history or delete the failed release tag. Publish a fixed
version.

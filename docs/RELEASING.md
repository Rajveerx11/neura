# Releasing Neura

## Version policy

Neura uses semantic versions:

- patch: fixes with no intended capability expansion;
- minor: new user-visible capability or mode behavior;
- major: incompatible configuration, policy, or installation change;
- `-rc.N`: release candidate that still has named gates.

`VERSION` is the machine-readable source. Changelog and release-note filenames
must match it.

Latest release remains `2.5.1`. Work, modular verification, and Learn are merged
but unreleased. Prepare a new version and release note for their eventual
release; do not retrofit their behavior into historical v2.5.1 notes.

## Open-source release gate

The repository is public, but a promoted release still requires every applicable
item in [OPEN_SOURCE.md](OPEN_SOURCE.md). Public visibility, a GitHub draft,
package publication, live installation, and production readiness are independent.
Both npm manifests stay private and release automation must never publish to a
package registry. Public release notes must say `experimental` until the
production gate below passes.

## Stable-release gate

All items must pass:

- [ ] `docs/STATUS.md` says stable-ready and has no required stable blockers.
- [ ] `node scripts\verify-harness.mjs` passes.
- [ ] `node scripts\verify-sandbox.mjs` passes on the release workstation.
- [ ] `npm run typecheck`, `npm audit --audit-level=high`, and
      `npm audit signatures` pass from clean lockfile installs. Repeat both
      audit commands with `--prefix agent/neura` for the Learn runtime graph.
- [ ] Plan accessibility and `node scripts\tests\learn-browser.mjs` pass in real
      Edge at narrow/desktop widths; the 18-suite harness includes nonbrowser Learn checks.
- [ ] `node scripts\check-docs.mjs` passes.
- [ ] Windows and Linux portable CI pass on the release commit. Contract tests
      do not replace the Windows live WSL2/bubblewrap rehearsal.
- [ ] `git diff --check` passes.
- [ ] `powershell -File .\install.ps1 -Check` passes after an intentional live sync.
- [ ] Pi and every runtime package are pinned and audited.
- [ ] Learn's manifest, lockfile, worker, installed runtime, and lock receipt are
      present; native-Windows first store creation and failure paths are exercised.
- [ ] Approvals, redaction, and Gmail policy meet the gates in `STATUS.md`.
- [ ] No credential, private memory, approval audit, session file, personal
      endpoint, or machine-specific path is tracked in public defaults.
- [ ] `scripts/verify-secrets.ps1` passes against complete Git history.
- [ ] Every entry in `docs/SECURITY_INCIDENTS.md` is closed with owner-confirmed
      revocation and documented scope.
- [ ] Release notes state user-visible changes, limits, migration, verification, and rollback.
- [ ] Selected open-source license is present and recognized by GitHub.
- [ ] README, security, support, conduct, governance, issue forms, pull-request
      template, CODEOWNERS, and package metadata are current.
- [ ] GitHub description, topics, branch protection, private vulnerability
      reporting, security alerts, and Actions permissions are reviewed.
- [ ] Worktree is clean and local `main` matches `origin/main`.

Human Away expansion also requires the separate sandbox and adversarial-replay
gates in [STATUS.md](STATUS.md).

## Production-release gate

A production-ready claim additionally requires:

- [ ] Every P0 item in
      [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) is closed.
- [ ] Every security-critical P1 acceptance criterion and negative test passes.
- [ ] Strict TypeScript and the hermetic/adversarial suites pass.
- [ ] Secret scanning reports no unresolved incident.
- [ ] Clean install, interrupted install, upgrade, rollback, and live-manifest
      rehearsals pass on a disposable Windows host.
- [ ] Unknown live extensions, floating executables, and source/live drift are absent.
- [ ] Human Away is either still preview-disabled or has passed its separate field gates.
- [ ] Status and release notes state the exact supported scope and remaining limitations.

Production claims follow evidence, not dates. Exceptions require a named owner,
expiry, compensating control, and tracked issue.

## Automated draft-prerelease path

Tag automation accepts only an annotated `v*` tag whose target is contained in
`origin/main`. `VERSION`, root package and lock versions, nested package/lock
versions, and `docs/releases/v$version.md` must agree. Run locally before tagging:

```powershell
$version = (Get-Content .\VERSION -Raw).Trim()
npm run test:release
npm run verify:release -- --tag "v$version"
```

Every prerelease note must declare `Channel: prerelease` and state all of:

- This release is experimental and not production-ready.
- Human Away remains preview-only and is not approved for unattended high-impact work.
- No npm package is published by this release.

The tag workflow reruns repository, browser, audit, signature, secret-history,
and ephemeral installer checks. It builds a deterministic source tarball, SPDX
SBOM snapshots for both lockfiles, and `SHA256SUMS`, then retains that workflow artifact
for three days. Only the final job receives `contents: write`, and it uses GitHub
CLI to create a **draft prerelease**. It never publishes npm packages and never
promotes or publishes the GitHub draft. A maintainer must inspect any draft and
all remaining gates manually.

Stable semantic-version tags are deliberately rejected unless
[STATUS.md](STATUS.md) contains the exact machine-readable line
`Release channel: stable-ready` and no `not production-ready` statement. A
release candidate such as `v2.6.0-rc.1` is the only currently eligible automated
channel.

## Tag commands

Run only after the checklist passes, the RC release note is present, `main` is
pushed, and the tag operation is approved:

```powershell
$version = (Get-Content .\VERSION -Raw).Trim()
git tag -a "v$version" -m "Neura v$version"
git push origin "v$version"
```

Do not tag an RC as stable or describe preview boundaries as production-safe.
Tagging starts automation; it is not approval to publish the resulting draft.

## Rollback

1. Stop every Neura process, approval writer, and active external automation.
2. Check out the previous known-good tag in a separate worktree.
3. Install that tag's development/runtime graphs with scripts disabled and run
   its documented verifier. Older tags may not contain a nested Learn graph.
4. With owner authorization, install that tag with its `install.ps1`.
5. Run `install.ps1 -Check`.
6. Record the rollback reason in the next changelog entry.

Do not rewrite shared history or delete the failed release tag. Publish a fixed
version.

Older approval writers may not honor the current cross-process lock. Do not
repair or discard an invalid audit tail to make rollback pass. Saved Learn files
and additive proof receipts can remain local; older code may ignore them. Do not
delete private learning data as part of rollback. See [VERIFICATION.md](VERIFICATION.md).

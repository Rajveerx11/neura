# Releasing Neura

## Current release decision

**Release blocked.** The active Mastra application is for development/testing
with synthetic, non-sensitive data. Mastra EE scope and distribution approval
remain unresolved. `npm run verify:release` intentionally refuses distribution.
Do not bypass it, promote a draft or infer production readiness from passing tests.

Package metadata and `VERSION` remain `2.6.0-rc.1`. “v1” means the Mastra
implementation, not a selected public version. The latest published release is
the historical Pi-based `v2.5.1`. The existing `v2.6.0-rc.1` draft remains
unpublished/withheld. See the [release inventory](releases/README.md) and [status](STATUS.md).
The [dependency review](MASTRA_V1_DEPENDENCIES.md) records the license boundary.

Updating About text, a release description or documentation does not create a
release. Version selection, commits, tag/push operations, draft publication,
package distribution and live installation each require explicit authorization.
Both npm manifests remain private. No workflow publishes an npm package.

## Version policy

Use semantic versions after the owner selects an authorized release scope:
patch for compatible fixes, minor for compatible capability additions, major
for incompatible policy/configuration/install changes, and `-rc.N` for a
candidate with remaining gates. No migration-version decision has been made.

For a future candidate, reconcile `VERSION`, root package/lock identity and
`docs/releases/v<version>.md` with reviewed packaging/runtime contracts. The
private Learn runtime has its own version. Its manifest and lock must agree.
Historical Pi manifests are evidence and must not be treated as an active
Mastra distribution manifest.

## Gates before any release

- [ ] Resolve the Mastra EE/distribution scope with recorded owner approval.
- [ ] Define the supported features and platform. Name the exact source revision. Reconcile
      the [parity matrix](PARITY_MATRIX.md) without promoting mock evidence to parity.
- [ ] Pass `npm run verify`, Learn browser checks and `git diff --check` on the candidate.
- [ ] Pass actual configured-host `npm run test:v1:work-sandbox` and the separate
      `npm run verify:sandbox`. Synthetic/hosted contracts do not replace them.
- [ ] Install both exact graphs cleanly with scripts disabled. Pass vulnerability
      and registry-signature audits with `npm run audit:all`.
- [ ] Pass complete-history secret scanning and scanner regressions. Close any
      incident with owner-confirmed revocation and value-free evidence.
- [ ] Review source, author metadata, plans, assets, issues, release text and CI
      artifacts for private material and redistribution rights. The current
      logo's trademark clearance/distribution terms remain undocumented.
- [ ] Demonstrate clean-profile install, interrupted upgrade, preservation and
      rollback on a disposable Windows host. A source-linked launcher is not
      sealed or reproducible distribution evidence.
- [ ] Obtain independent review and required new-head CI, including `harness`,
      `portable-proof` and applicable security checks. Report failed/skipped review honestly.
- [ ] Reconcile README, security/support/contribution docs, About/topics, release
      notes and assets with the tested scope. Historical releases remain historical.
- [ ] Complete applicable [open-source](OPEN_SOURCE.md), [installer](INSTALLER_READINESS.md)
      and [production](PRODUCTION_READINESS.md) gates for the proposed claim.
- [ ] Verify the exact candidate is reviewed, clean and on the authorized main
      revision before any separately approved tag/publication operation.

Human Away is unavailable in the active CLI. Its retained preview source does
not authorize unattended operation. Full trusted proof remains unavailable. Detector receipts cannot satisfy a completion gate.

## Existing tag workflow

`.github/workflows/release.yml` accepts `v*` tag pushes, requires an annotated
tag whose target is contained in `origin/main`, installs both locked graphs and
checks the active dependency boundary. It calls `verify:release` before audits,
repository verification, configured-host Work acceptance, browser checks and
secret-history/installer checks. It currently stops at the license gate.

Later jobs contain source/archive/SBOM/checksum and draft-prerelease machinery
inherited from the Pi pipeline. Those retained steps are not certified Mastra
packaging. Reconcile their scripts, runtime ownership and manifests before
unblocking release. Removing a license denial alone is insufficient. Source
archives do not bundle Node, WSL, bubblewrap or a complete runtime.

No tag command is a current setup step. Do not run archived `check:pi-latest`,
`test:release`, legacy installer or Pi update commands against the active source.
Do not delete the existing draft or replace published tags merely to satisfy automation.

## Release notes

Notes must state the exact channel/revision, user-visible changes, verification,
known limitations, installation/migration and rollback. Distinguish source
availability, a draft, published artifacts, installed code and production readiness.
Keep experimental language until its gates pass. Disclose no npm publication.

Published `v2.5.1` notes retain their original body, with a dated historical-scope
notice. The withheld candidate links to its frozen Pi record and current
development summary. Do not rewrite old test evidence as a new acceptance run.

## Rollback

Exit Neura and stop relevant writers before changing source or launcher. For
development use, select a known-good checkout explicitly. Restore only a verified
installer-owned launcher backup after checking destination ownership. There is
no automatic rollback command or sealed runtime restoration.

Preserve dirty worktrees, credentials, sessions, memory, approvals, learning data
and vaults, along with recovery backups. Do not downgrade standalone Pi, repair audit tails
or erase private data to force compatibility. Do not rewrite shared history or
published tags. Record corrections in a separately approved release. Follow
[installer preservation rules](INSTALLER_READINESS.md).

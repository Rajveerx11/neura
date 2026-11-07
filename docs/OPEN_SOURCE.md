# Open-source publication checklist

## Current source and distribution (2026-11-07)

The repository is public, but the active Mastra Work/Learn build is restricted
to development/testing with synthetic, non-sensitive data. Mastra EE scope and
distribution approval remain unresolved. `verify:release` intentionally fails.
The source license does not relicense dependencies. New logo trademark clearance
and redistribution terms remain undocumented. The historical artwork's terms
do not clear the new assets. See [releasing](RELEASING.md) and
[dependency review](MASTRA_V1_DEPENDENCIES.md).

The latest published release is historical Pi `v2.5.1`. `v2.6.0-rc.1` stays a
withheld draft. Current user/contributor docs describe Mastra only. Old exported
plans and marketing graphics have frozen-history links instead of checkout copies.
GitHub About/topics and both existing release descriptions were reconciled with
this scope on 2026-11-07. The candidate remains a draft and the published release
keeps its original body beneath a historical notice. This does not approve
publication, change protection settings or close gates.

The checklist below retains dated publication evidence. Checked historical items
are not fresh verification of repository settings, the new logo, installability
or current release readiness. Recheck every applicable item before distribution.

Publication checklist established: 2026-09-04. Public-state reconciliation: 2026-09-13.

This checklist separates repository publication from production readiness.
Neura can be open source while remaining experimental and unsuitable for
production or unattended high-impact work.

The GitHub repository is public. It includes Apache-2.0, community files, CI,
security automation, package metadata, and public-safe default configuration
templates. Both npm manifests remain private and no workflow publishes to a
package registry. Public source visibility, release approval, live installation,
and production readiness are separate decisions.

## Included in this revision

- [x] README describes purpose, install, configuration, commands, risks, and
      supported platform.
- [x] Apache-2.0 [LICENSE](../LICENSE), [NOTICE](../NOTICE), and SPDX package
      metadata are present.
- [x] Contribution, conduct, support, governance, security, and pull-request
      policies are present.
- [x] Structured bug and feature issue forms are present.
- [x] CODEOWNERS identifies current maintainer.
- [x] CI verifies TypeScript, harness behavior, accessibility, documentation,
      dependencies, signatures, installer drift, and complete history for
      secrets.
- [x] Current status clearly separates open-source availability from production
      claims.
- [x] Historical release records remain labelled with channel that applied when
      published.

The `2.6.0-rc.1` source candidate includes Work, Learn, Pi `1.3.0`, and the
18-suite verifier. Candidate metadata and a GitHub draft do not establish a
published release or completion of the remaining gates.

## Remaining public-release work

- [x] Owner confirmed historical token revocation and closed remaining evidence
      in [SECURITY_INCIDENTS.md](SECURITY_INCIDENTS.md) and
      [#36](https://github.com/Rajveerx11/neura/issues/36).
- [x] GitHub recognizes Apache-2.0 on the public repository.
- [x] Complete-history Gitleaks scan passed immediately after publication on
      2026-09-15; rerun it before every release.
- [ ] Review Git author metadata, issue content, pull-request content, release
      text, Actions artifacts, screenshots, and historical plans for personal or
      confidential information.
- [x] Replace or disable machine-specific MCP paths, personal skill paths,
      provider-specific endpoints, and launcher credential imports in public
      defaults; verify installer behavior after change.
- [x] Replaced the undocumented launch image with the owner-supplied Neura logo;
      [provenance and Apache-2.0 distribution terms](../agent/neura/launch-artwork.md)
      are recorded. README screenshots are generated from synthetic fixtures by
      the repository's browser suites.
- [x] Repository description and topics match README.
- [x] Protect `main` with strict up-to-date `harness` and `portable-proof`
      checks, one approval, code-owner and stale-review enforcement,
      conversation resolution, linear history, and no force push or deletion.
      Administrator enforcement remains off, so sole administrator Rajveerx11
      can bypass.
- [x] Enable private vulnerability reporting, Dependabot security updates,
      secret scanning, and push protection.
- [x] Set Actions defaults read-only, prevent Actions from approving pull
      requests, and limit use to GitHub-owned SHA-pinned actions.
- [x] GitHub Discussions, Projects, and Wiki remain disabled until a maintained
      workflow justifies enabling them.
- [x] Repository visibility is public. Unchecked release and production gates
      remain blockers despite that visibility.

## Public-repository follow-up

- [x] GitHub Community Standards reports 100% and recognizes README, license,
      contributing guide, code of conduct, pull-request template, and security
      policy. The API does not surface structured issue forms in its legacy
      `issue_template` field.
- [ ] Verify clone and documented install from a new, unprivileged Windows test
      profile.
- [ ] Verify badge, issue forms, private advisory flow, branch protection, and CI
      from an external contributor account.
- [x] Prepared [v2.6.0-rc.1 notes](releases/v2.6.0-rc.1.md) with experimental
      support scope, remaining limitations, migration, and rollback.
- [ ] Re-run dependency, signature, secret, and documentation checks.

## Current blockers

A promoted release should not occur while the final clean-checkout
history/content audit or another checklist item remains incomplete. Public
visibility does not waive those blockers. Production use has additional blockers in
[PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).

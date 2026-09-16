# Open-source publication checklist

Publication checklist established: 2026-09-04. Public-state reconciliation: 2026-09-13.

This checklist separates repository publication from production readiness.
Neura can be open source while remaining experimental and unsuitable for
production or unattended high-impact work.

The GitHub repository is public. It includes Apache-2.0, community files, CI,
security automation, and package metadata. Both npm manifests remain private and
no workflow publishes to a package registry. Public source visibility, release
approval, live installation, and production readiness are separate decisions.

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

Merged main also contains Work, Learn, and the 18-suite verifier. These are
unreleased additions to `2.5.1`, not evidence that a new public release exists.

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
- [ ] Replace or disable machine-specific MCP paths and provider-specific
      endpoints in public defaults; verify installer behavior after change.
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
- [ ] Create release notes that state experimental support scope and rollback.
- [ ] Re-run dependency, signature, secret, and documentation checks.

## Current blockers

A promoted release should not occur while public defaults expose machine-specific
integration configuration or the remaining checklist is incomplete. Public
visibility does not waive those blockers. Production use has additional blockers in
[PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).

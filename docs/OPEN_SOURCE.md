# Open-source publication checklist

Publication checklist established: 2026-09-04. Status reconciled: 2026-09-07.

This checklist separates repository publication from production readiness.
Neura can be open source while remaining experimental and unsuitable for
production or unattended high-impact work.

GitHub visibility remains private. This revision includes Apache-2.0, community
files, and package metadata. GitHub license recognition must be verified after
push. Public visibility and live installation remain separate owner actions.

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

Merged main also contains Work, Learn, and the 17-suite verifier. These are
unreleased additions to `2.5.1`, not evidence that a new public release exists.

## Required before changing visibility

- [x] Owner confirmed historical token revocation and closed remaining evidence
      in [SECURITY_INCIDENTS.md](SECURITY_INCIDENTS.md) and
      [#36](https://github.com/Rajveerx11/neura/issues/36).
- [ ] After license commit is pushed, verify GitHub recognizes Apache-2.0.
- [ ] Re-run complete-history secret scan from clean checkout immediately before
      publication.
- [ ] Review Git author metadata, issue content, pull-request content, release
      text, Actions artifacts, screenshots, and historical plans for personal or
      confidential information.
- [ ] Replace or disable machine-specific MCP paths and provider-specific
      endpoints in public defaults; verify installer behavior after change.
- [ ] Confirm all bundled images and text may be redistributed under project
      license or carry their own notices.
- [ ] Confirm repository description and topics match README.
- [ ] Configure default branch protection to require `verify` checks and review
      before merge.
- [ ] Enable private vulnerability reporting and dependency/security alerts.
- [ ] Review Actions token permissions, fork pull-request behavior, and artifact
      retention for public-repository threat model.
- [ ] Decide whether GitHub Discussions and Projects should remain disabled or
      private; do not enable unused surfaces.
- [ ] Make repository public only after preceding checks pass.

## After publication

- [ ] Verify Community Standards profile recognizes README, license, contributing
      guide, code of conduct, issue templates, pull-request template, and
      security policy.
- [ ] Verify clone and documented install from a new, unprivileged Windows test
      profile.
- [ ] Verify badge, issue forms, private advisory flow, branch protection, and CI
      from an external contributor account.
- [ ] Create release notes that state experimental support scope and rollback.
- [ ] Re-run dependency, signature, secret, and documentation checks.

## Current blockers

Publication should not occur while public defaults expose machine-specific
integration configuration or the remaining checklist is incomplete.
Production use has additional blockers in
[PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).

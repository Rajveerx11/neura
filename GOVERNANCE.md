# Governance

Neura uses maintainer-led governance.

## Roles

- Maintainer: repository owner, currently
  [@Rajveerx11](https://github.com/Rajveerx11).
- Contributor: anyone submitting issues, documentation, tests, code, or review.

Maintainer decides roadmap, release scope, security response, merge approval,
and repository settings. Contributors retain authorship of their work and
license accepted contributions under Apache-2.0.

## Decisions

Routine decisions happen in issues and pull requests. Significant changes need
written rationale, alternatives, security impact, migration, rollback, and test
evidence. Deterministic safety policy, current status, and production gates
cannot be weakened by undocumented exception.

Security-sensitive discussion moves to a private advisory. Maintainer may close
reports that expose secrets or private user data after preserving a safe record.

## Releases

Maintainer approves releases using [docs/RELEASING.md](docs/RELEASING.md).
Open-source availability does not make a release production-ready. Production
claims require every gate in
[docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md).

## Changes to governance

Governance changes use a normal reviewed pull request. Maintainer succession or
additional maintainer appointment must be recorded in this file and CODEOWNERS.

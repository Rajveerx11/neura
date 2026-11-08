# Neura documentation

Updated 2026-11-07 against the active Mastra application and recent changes
through `6a63952` (#153). Work and Learn are the only implemented modes.
Development/testing uses synthetic, non-sensitive data while Mastra EE scope and
distribution approval remain unresolved. No production readiness is claimed.

## Start here

| Need | Guide |
| --- | --- |
| Understand Neura and run it from source | [Official README](../README.md) |
| Check implemented behavior and open gates | [Status](STATUS.md), [Mastra implementation/evidence](MASTRA_V1.md), [parity matrix](PARITY_MATRIX.md) |
| Choose a provider or diagnose subscription access | [Authentication](CODEX_AUTH.md) |
| Register Neura as a local T3 Code development provider | [T3 Code integration](T3_CODE.md) |
| Learn from documents and save progress | [Learn Mode](LEARN_MODE.md), [document runtime](LEARN_DEPENDENCIES.md) |
| Understand Work review and proof limits | [Verification](VERIFICATION.md) |
| Resolve a setup problem | [Support](../SUPPORT.md) |
| Report a vulnerability privately | [Security policy](../SECURITY.md) |

## Build and maintain

| Need | Guide |
| --- | --- |
| Set up a checkout and contribute | [Development](DEVELOPMENT.md), [Contributing](../CONTRIBUTING.md) |
| Trace the active source and stored data | [Architecture](ARCHITECTURE.md) |
| Review exact pins and package-closure/license gates | [Dependency policy](DEPENDENCIES.md), [Mastra closure review](MASTRA_V1_DEPENDENCIES.md) |
| Change terminal or board presentation | [Design](../DESIGN.md), [terminal UX](TERMINAL_UX.md) |
| Understand development-launcher ownership and rollback | [Installer readiness](INSTALLER_READINESS.md) |
| Prepare a future release | [Releasing](RELEASING.md), [release inventory](releases/README.md), [open-source checklist](OPEN_SOURCE.md) |
| Track unmet security/operational requirements | [Production readiness](PRODUCTION_READINESS.md) |
| Follow repository and community rules | [AGENTS.md](../AGENTS.md), [CLAUDE.md](../CLAUDE.md), [Governance](../GOVERNANCE.md), [Code of conduct](../CODE_OF_CONDUCT.md) |

## History and migration evidence

The latest published release is the Pi-based `v2.5.1`. Package metadata remains
`2.6.0-rc.1`, whose GitHub draft is withheld. Neither is a published Mastra build.
See the [changelog](CHANGELOG.md) for current unreleased changes before the
historical release record.

Retained [capability contracts](CAPABILITY_CONTRACTS.md),
[Plan confidentiality](PLAN_CONFIDENTIALITY.md), [skills](SKILLS.md),
[plans](../plans/README.md), [Herdr integrations](../integrations/herdr-workspace/README.md)
and [migration reference](MASTRA_MIGRATION_REFERENCE.md) describe shared internals
or historical Pi behavior. They do not expose those features in the active CLI.
The migration reference is retained unchanged. Use current source, status and
the parity matrix for implementation claims.

Keep dated evidence and the [security incident record](SECURITY_INCIDENTS.md).
Do not turn old test results, release instructions or plans into current acceptance.

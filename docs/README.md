# Neura documentation

Start with the [Windows quick start](../README.md#quick-start-from-source).
The current Neura build is for development and testing with synthetic data.
See [status](STATUS.md) for what's implemented and what still blocks release.

## Start here

| Need | Guide |
| --- | --- |
| Install or update from source | [Quick start](../README.md#quick-start-from-source), [installer and rollback](INSTALLER_READINESS.md) |
| Use the CLI, choose a model or schedule Work | [Usage](USAGE.md) |
| Diagnose subscription access | [Authentication](CODEX_AUTH.md) |
| Discover and use installed Agent Skills | [Skills](SKILLS.md) |
| Register Neura as a local T3 Code development provider | [T3 Code integration](T3_CODE.md) |
| See the interface, learn from documents and save progress | [Learn visual tour](LEARN_MODE.md#visual-tour), [lesson workflow](LEARN_MODE.md#start-a-lesson), [document runtime](LEARN_DEPENDENCIES.md) |
| Understand Work review and proof limits | [Verification](VERIFICATION.md) |
| Resolve a setup problem | [Support](../SUPPORT.md) |
| Report a vulnerability privately | [Security policy](../SECURITY.md) |

## Build and maintain

| Need | Guide |
| --- | --- |
| Set up a checkout and contribute | [Development](DEVELOPMENT.md), [Contributing](../CONTRIBUTING.md) |
| Trace entry points, tool authority and owned data | [Architecture diagram and source map](ARCHITECTURE.md) |
| Reproduce the real-renderer documentation images | [Screenshot provenance and capture recipe](../assets/screenshots/README.md) |
| Review exact pins and package-closure/license gates | [Dependency policy](DEPENDENCIES.md), [Mastra closure review](MASTRA_V1_DEPENDENCIES.md) |
| Change terminal or board presentation | [Design](../DESIGN.md), [terminal UX](TERMINAL_UX.md) |
| Understand development-launcher ownership and rollback | [Installer readiness](INSTALLER_READINESS.md) |
| Prepare a future release | [Releasing](RELEASING.md), [release inventory](releases/README.md), [open-source checklist](OPEN_SOURCE.md) |
| Track unmet security/operational requirements | [Production readiness](PRODUCTION_READINESS.md) |
| Follow repository and community rules | [AGENTS.md](../AGENTS.md), [CLAUDE.md](../CLAUDE.md), [Governance](../GOVERNANCE.md), [Code of conduct](../CODE_OF_CONDUCT.md) |

## History and migration evidence

The latest published release is the Pi-based `v2.5.1`. `v2.6.0-rc.3` is a
source prerelease of the current application, not a stable release.
See the [changelog](CHANGELOG.md) for current unreleased changes before the
historical release record. See the [implementation record](MASTRA_V1.md) and
[parity matrix](PARITY_MATRIX.md) for dated migration evidence.

Retained [capability contracts](CAPABILITY_CONTRACTS.md),
[Plan confidentiality](PLAN_CONFIDENTIALITY.md),
[plans](../plans/README.md), [Herdr integrations](../integrations/herdr-workspace/README.md)
and [migration reference](MASTRA_MIGRATION_REFERENCE.md) describe shared internals
or historical Pi behavior. They do not expose those features in the active CLI.
The migration reference is retained unchanged. Use current source, status and
the parity matrix for implementation claims.

Keep dated evidence and the [security incident record](SECURITY_INCIDENTS.md).
Do not turn old test results, release instructions or plans into current acceptance.

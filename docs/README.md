# Documentation

## Current application: Mastra development build

The active source implements Work and Learn only. It is not the latest published
Pi-based release and has no full legacy parity. Start with the
[project README](../README.md) for native Windows prerequisites, source-linked
setup, disposable-workspace tests and rollback. The development launcher requires
an ASCII-only checkout path. Read
[implementation and dated evidence](MASTRA_V1.md),
[subscription login and privacy gates](CODEX_AUTH.md), and
[dependency licensing review](MASTRA_V1_DEPENDENCIES.md) before testing.
Development/testing is restricted to synthetic, non-sensitive data while the
Mastra EE scope and distribution gate remain open. Real-account login and model
entitlement are unverified. No production or redistribution approval is claimed.

## Historical Pi references

The guides below describe the retained Pi baseline unless explicitly marked as
current Mastra documentation. They do not establish active features or permission
to reinstall Pi. The metadata candidate remains `2.6.0-rc.1`. Latest published
Neura remains the Pi-based `2.5.1`. Older installations can differ.
[STATUS.md](STATUS.md) separates current gates from historical evidence.

## Use Neura

| Need | Read |
|---|---|
| Install, choose a mode, find a command | [Project README](../README.md) |
| Learn practically with diagrams, PDFs, PPTX, and exercises | [Learn Mode](LEARN_MODE.md) |
| Understand supported document formats, OCR, and limits | [Learn document runtime](LEARN_DEPENDENCIES.md) |
| Resolve setup or learning problems | [Support](../SUPPORT.md) |
| Check what is shipped, unreleased, or blocked | [Current status](STATUS.md) |
| Understand security boundaries or report privately | [Security policy](../SECURITY.md) |

## Develop and maintain

| Need | Read |
|---|---|
| Set up a checkout and contribute | [Development](DEVELOPMENT.md), [Contributing](../CONTRIBUTING.md) |
| Trace modes, extensions, lifecycle, and stored state | [Architecture](ARCHITECTURE.md) |
| Read historical migration planning, not active requirements | [Historical Mastra planning evidence](https://github.com/Rajveerx11/neura/blob/136c4ef14b4a2023bed56d8ec3506bfa1558ef15/docs/MASTRA_MIGRATION_REFERENCE.md) |
| Run suites and understand proof receipts | [Verification](VERIFICATION.md) |
| Review dependency pins and executable trust | [Dependency policy](DEPENDENCIES.md), [Learn runtime review](LEARN_DEPENDENCIES.md) |
| Apply terminal and learning-board design rules | [Design system](../DESIGN.md) |
| Follow coding-agent constraints | [AGENTS.md](../AGENTS.md), [CLAUDE.md](../CLAUDE.md) |
| Review production blockers | [Production readiness](PRODUCTION_READINESS.md) |
| Prepare Neura's one-step installer | [Installer readiness](INSTALLER_READINESS.md) |
| Prepare publication or a release | [Open-source checklist](OPEN_SOURCE.md), [Releasing](RELEASING.md) |
| Review community responsibilities | [Governance](../GOVERNANCE.md), [Code of conduct](../CODE_OF_CONDUCT.md) |

## History and evidence

- [Changelog](CHANGELOG.md)
- [v2.6.0-rc.1 candidate](releases/v2.6.0-rc.1.md)
- [v2.5.1 release](releases/v2.5.1.md)
- [v2.5.1 release candidate](releases/v2.5.1-rc.1.md)
- [Historical plans](../plans/README.md)
- [Value-free security incident record](SECURITY_INCIDENTS.md)

Update current guides when behavior changes. Preserve historical evidence;
never silently convert an old plan, release, or test result into a current claim.

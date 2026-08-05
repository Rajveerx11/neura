# Contributing

Neura is currently a private personal project. Contributions require repository
owner approval. No public support or compatibility commitment exists yet.

## Before changing code

1. Read [docs/STATUS.md](docs/STATUS.md), [AGENTS.md](AGENTS.md), and relevant source.
2. State the exact behavior being changed and its observable completion test.
3. Keep personal configuration, credentials, memory, sessions, and approval data out of the repository.

## Change standard

- One focused concern per commit.
- Root-cause fix, not symptom masking.
- Regression tests for behavior changes.
- Negative tests for policy and trust boundaries.
- No new unpinned dependency.
- No hidden network, process, filesystem, or remote mutation.
- Documentation updated with behavior.
- Historical plans never override current source or status documents.

## Verify

```powershell
node scripts\verify-harness.mjs
node scripts\check-docs.mjs
git diff --check
```

Include commands and exact outcomes in the change description. If a check cannot
run, state why. Do not describe unverified work as complete.

## Commit style

Use an imperative Conventional Commit subject:

```text
fix: enforce Plan filesystem containment
docs: prepare v2.5.1 release candidate
```

## Security changes

Do not open a public issue containing exploit details, credential material, or
private machine state. Follow [SECURITY.md](SECURITY.md).

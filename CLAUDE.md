# Claude Code instructions

Follow [AGENTS.md](AGENTS.md). It contains repository rules, required checks, and
security constraints for every coding agent.

Read these before non-trivial work:

- [Current status and blockers](docs/STATUS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Development workflow](docs/DEVELOPMENT.md)
- [Security policy](SECURITY.md)

Important platform facts:

- Pi loads the live copy under `~/.pi/agent/`; edit `C:\Neura` first.
- Windows npm command shims may require `cmd /c` when spawned without a shell.
- `agent_settled` occurs after `agent_end`; this ordering currently makes
  proof-before-autogit a release blocker.
- Print mode cannot reliably complete interactive async follow-ups.
- Detect worktree changes from Git state, not tool names.

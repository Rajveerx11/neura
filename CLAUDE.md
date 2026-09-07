# Claude Code instructions

Follow [AGENTS.md](AGENTS.md). It contains repository rules, required checks, and
security constraints for every coding agent.

Read these before non-trivial work:

- [Current status and blockers](docs/STATUS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Development workflow](docs/DEVELOPMENT.md)
- [Verification suites and proof](docs/VERIFICATION.md)
- [Learn Mode and limits](docs/LEARN_MODE.md)
- [Security policy](SECURITY.md)

Important platform facts:

- Pi loads live copy under `~/.pi/agent/`; edit repository checkout first.
- Windows npm command shims may require `cmd /c` when spawned without a shell.
- `agent_settled` occurs after `agent_end`; quick proof runs in Work/YOLO.
  `/ship` verifies only. It does not commit, push, or merge.
- Print mode cannot reliably complete interactive async follow-ups.
- Detect worktree changes from content-bound Git/workspace fingerprints, including
  nonignored untracked files. Do not infer changes from tool names.
- Work is default. Mode restoration pauses tools until earlier host operations
  drain, and saved YOLO requires fresh confirmation.

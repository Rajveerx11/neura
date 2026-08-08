# Security policy

## Supported version

Only current `main` receives security fixes. `2.5.1-rc.1` is a private release
candidate, not a production security boundary.

## Report a vulnerability

Contact the repository owner privately or use a private GitHub security advisory.
Include affected version, exact boundary, safe reproduction, impact, and suggested
fix. Never include a real credential or private user data.

## Secret handling

- Store credentials in user environment variables or provider-managed stores.
- Never commit `.env` files, auth files, model credentials, memory, sessions, or approval logs.
- Use synthetic values in tests.
- Revoke and rotate any credential exposed in a command line, log, screenshot,
  transcript, issue, commit, or model context. Deleting the visible copy is not enough.

## Current security model

- Plan uses a fixed tool set and canonical workspace containment.
- Plan Git inspection accepts only command-specific read options. Every Git call
  disables paging, optional locks, lazy fetching, configured filesystem monitors,
  repository hooks, configured or custom signature display, and mailmaps; diff,
  log, and show also disable external diff and text-conversion drivers. Git reads
  are limited to objects, refs, and the index because worktree inspection can
  invoke configured clean or process filters. Unstaged diff requires one explicit
  revision range followed by `--` so filename-like tokens cannot select the
  worktree form.
- Plan permits bounded `web_search` but denies direct `web_fetch`; its delegated
  backend does not expose DNS answers, connection IPs, or redirect hops needed
  for SSRF-safe enforcement.
- Plan HTML uses structured input, escaping, CSP, safe URL checks, collision-safe
  creation, and session-owned revision hashes.
- YOLO intentionally disables Neura application approvals and tool blocking. On
  native Windows it has no OS sandbox; tool access follows the process and
  signed-in user's permissions.
- Human Away combines deterministic policy with an isolated no-tool reviewer and
  a local hash-chained approval audit.
- Headmaster cannot widen deterministic policy.
- Application policy reduces mistakes in Plan and Human Away but does not provide
  OS isolation. YOLO bypasses that policy by design.

## Known limitations

- YOLO can read or modify files outside the workspace, use the network, invoke
  external tools, and trigger destructive or remote side effects without a
  confirmation prompt. Misuse can cause data loss or account impact.
- Plan and Human Away have no WSL2/container sandbox.
- Approval grants do not yet bind every relevant target/content/Git state.
- Redaction is pattern-based and incomplete.
- Outside YOLO, Gmail confirms known mutation names instead of allowing only
  explicit reads. YOLO intentionally bypasses this confirmation.
- Optional MCP and model providers expand the network and credential surface.

Full release gates are tracked in [docs/STATUS.md](docs/STATUS.md). Do not remove
preview labels until those gates pass.

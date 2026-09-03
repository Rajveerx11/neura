# Security policy

## Supported version

Only current `main` receives security fixes. `2.5.1` is a private stable
release, not a general production or multi-user security boundary. Current
`main` is also not approved for a production claim while the named P0 and
security-critical P1 issues remain open.

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
- Record closure evidence without secret material in
  [docs/SECURITY_INCIDENTS.md](docs/SECURITY_INCIDENTS.md).

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
  a local hash-chained approval audit. Its only provider-visible tool executes
  through WSL2 bubblewrap with a workspace-only writable mount, cleared host
  environment, hidden Windows/WSL user paths, and an unshared network namespace.
- One-use approval retries bind canonical target identity, target content/state,
  exact input, workspace state, `HEAD`, index state, and a 120-second expiry.
- Action summaries, cockpit notices, approval text, reviewer dossiers, Gmail
  summaries, and sandbox output use one central redaction implementation.
- Outside YOLO, Gmail permits only explicitly allowlisted reads without a prompt;
  every other action confirms interactively or blocks headless.
- Headmaster cannot widen deterministic policy.
- Application policy reduces mistakes in Plan and Human Away but does not provide
  OS isolation. YOLO bypasses that policy by design.

## Production security gate

A production claim requires all P0 issues and security-critical P1 acceptance
criteria in [PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md) to pass.
In particular:

- a supervised contained mode must be the default;
- unattended work must not trust repository-controlled scripts by command name;
- automatic executables must be pinned and contained;
- credential incidents must be explicitly closed;
- Plan, memory, MCP, Gmail, approvals, and skills must preserve confidentiality
  under adversarial tests;
- live installed code must match a reviewed manifest.

No date, version bump, model review, or basic green test suite can waive these
requirements. A temporary exception needs an owner, expiry, compensating
control, and tracked issue.

## Known limitations

- YOLO can read or modify files outside the workspace, use the network, invoke
  external tools, and trigger destructive or remote side effects without a
  confirmation prompt. Misuse can cause data loss or account impact.
- Plan uses application-level canonical containment rather than an OS sandbox.
- Human Away requires Windows, WSL2, and `bubblewrap`; tool execution fails closed
  when they are unavailable or a linked workspace entry is detected. It remains
  preview-labelled while field evidence accumulates.
- Redaction is pattern-based. Unknown secret formats can evade detection, so raw
  credentials must never be placed in prompts, commands, filenames, or output.
- Optional MCP and model providers expand the network and credential surface.

Full release gates are tracked in [docs/STATUS.md](docs/STATUS.md). Do not remove
preview labels until those gates pass.

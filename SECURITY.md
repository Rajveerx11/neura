# Security policy

## Supported version

Only current `main` receives security fixes. Historical `2.5.1` was a private
stable release for one operator; it is not a general production or multi-user
security boundary. Current `main` is a public-release candidate, not an
approved production release, while named P0 and security-critical P1 issues
remain open.

## Report a vulnerability

Use **Security > Report a vulnerability** in GitHub repository to open a private
security advisory. If private reporting is unavailable, contact repository owner
through GitHub without exploit details and request a private channel.

Include affected version, exact boundary, safe reproduction, impact, and
suggested fix. Never include a real credential or private user data. Maintainer
will acknowledge when practical, validate scope, coordinate a fix, and publish a
redacted advisory after affected users have a reasonable update window. No fixed
response-time or embargo guarantee is offered.

## Secret handling

- Store credentials in user environment variables or provider-managed stores.
- Never commit `.env` files, auth files, model credentials, memory, sessions, or approval logs.
- Use synthetic values in tests.
- Revoke and rotate any credential exposed in a command line, log, screenshot,
  transcript, issue, commit, or model context. Deleting the visible copy is not enough.
- Record closure evidence without secret material in
  [docs/SECURITY_INCIDENTS.md](docs/SECURITY_INCIDENTS.md).

## Current security model

- Work is the default supervised mode. Structured reads/edits/writes stay within
  the canonical workspace. `work_exec` uses network-disabled WSL2 bubblewrap;
  protected, remote, destructive, and unknown actions encounter deterministic
  policy and, where permitted, explicit interactive approval. Headless approval
  requests fail closed. Generic shell access is restricted to read-only inspection.
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
- Learn permits bounded `read`, `ls`, `web_search`, `questionnaire`, and its four
  learning tools. It denies generic writes/edits/shell, `grep`/`find`, MCP, Plan
  publication, private/configuration paths, hidden files, ADS, and linked/hardlinked
  inputs. Its writers use a marked local store and exclusive bounded files.
- PDF/PPTX content is untrusted reference data. Learn checks captured bytes,
  source identity, page/slide number, and quoted excerpts. It does not establish
  that a tutor's interpretation is correct. Parser workers have deadlines and
  heap limits but trust native/WASM code; they are not OS security sandboxes.
- Learn SQL uses a disposable in-memory SQLite process, an authorizer, fixed
  limits, and sample tables. No arbitrary host code, filesystem access, network,
  `ATTACH`, or writes are allowed. Browser lessons use fixed CSP and escaped
  HTML/SVG; worked answers are visible in their source, so this is not an exam system.
- YOLO intentionally disables Neura application approvals and tool blocking. On
  native Windows it has no OS sandbox; tool access follows the process and
  signed-in user's permissions. Every interactive transition into YOLO requires
  deliberate confirmation, and the post-splash footer keeps a danger label visible.
- Human Away combines deterministic policy with an isolated no-tool reviewer and
  a local hash-chained approval audit. Its only provider-visible tool executes
  through WSL2 bubblewrap with a workspace-only writable mount, cleared host
  environment, hidden Windows/WSL user paths, and an unshared network namespace.
- One-use approval retries bind canonical target identity, target content/state,
  exact input, workspace state, `HEAD`, index state, and a 120-second expiry.
- Approval writers lock across read/deduplication/append and flush completed
  writes. Lock contention has a two-second deadline, including Windows `EPERM`.
  Corrupt tails and crash locks fail closed; no automatic lock stealing or audit
  repair occurs. This is not authenticated protection against a same-user attacker.
- Action summaries, cockpit notices, approval text, reviewer dossiers, Gmail
  summaries, and sandbox output use one central redaction implementation.
- When a mode exposes Gmail tools outside YOLO, only explicitly allowlisted reads
  avoid a prompt; other actions confirm interactively or block headless. This
  guardrail never expands the selected mode's tool allowlist.
- Headmaster cannot widen deterministic policy.
- Work proof runs only in its network-disabled WSL sandbox with an already
  provisioned runner; unavailable execution never falls back to the host. YOLO
  retains host proof. `/ship` verifies and does not publish Git changes.
- Checkpoints/undo, host health, memory, skill scans, and October are YOLO-only.
- `/health` executes only existing absolute stdio MCP binaries and sends
  bounded initialize requests only to HTTPS or loopback HTTP endpoints.
  All configured HTTP header values must use placeholders from the existing
  explicit MCP environment allowlist; literal values are rejected regardless of
  header name. Protocol headers are supplied by the probe. Stdio probes receive
  no provider credentials; nonabsolute commands are not executed.
  Repository-defined MCP servers are reported but never auto-probed.
  Probe output and errors are bounded and redacted before display.
  Operation leases and paused session restoration prevent old work from crossing
  into a restricted mode. Late proof results cannot earn a new session receipt.
- Application policy is distinct from OS isolation. Work/Human Away command
  execution adds bubblewrap; Plan/Learn path checks remain application controls.
  YOLO intentionally bypasses Neura application policy.

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
- Plan and Work search paths still have confidentiality gaps; do not infer that
  a workspace boundary prevents discovery of ignored or historical secrets.
- Learn's first store initialization requires native Windows. Existing validated
  stores work on POSIX, but first creation there fails before writing. Path/handle
  revalidation does not isolate against a hostile same-user process moving paths.
- Saved learning content is private local data, not encrypted or authenticated
  evidence. Resumed excerpts are historical/unverified; new citations require
  source reimport. Browser progress transfers only through explicit user action.
- Human Away requires Windows, WSL2, and `bubblewrap`; tool execution fails closed
  when they are unavailable or a linked workspace entry is detected. It remains
  preview-labelled while field evidence accumulates.
- Redaction is pattern-based. Unknown secret formats can evade detection, so raw
  credentials must never be placed in prompts, commands, filenames, or output.
- Optional MCP and model providers expand the network and credential surface.

Full release gates are tracked in [docs/STATUS.md](docs/STATUS.md). Do not remove
preview labels until those gates pass.

Detailed parser limits: [Learn runtime review](docs/LEARN_DEPENDENCIES.md).
Proof and approval failure behavior: [Verification](docs/VERIFICATION.md).

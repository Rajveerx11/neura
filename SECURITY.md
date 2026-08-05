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
- Plan HTML uses structured input, escaping, CSP, safe URL checks, collision-safe
  creation, and session-owned revision hashes.
- YOLO confirms known sensitive actions but is not yet fail-closed for every
  unknown action.
- Human Away combines deterministic policy with an isolated no-tool reviewer and
  a local hash-chained approval audit.
- Headmaster cannot widen deterministic policy.
- Application policy reduces mistakes but does not provide OS isolation.

## Known limitations

- No WSL2/container sandbox.
- Unknown shell/MCP/custom actions can bypass YOLO confirmation.
- Proof currently runs after autogit starts; failed or unavailable proof does not
  block push.
- Approval grants do not yet bind every relevant target/content/Git state.
- Redaction is pattern-based and incomplete.
- Gmail confirms known mutation names instead of allowing only explicit reads.
- Optional MCP and model providers expand the network and credential surface.

Full release gates are tracked in [docs/STATUS.md](docs/STATUS.md). Do not remove
preview labels until those gates pass.

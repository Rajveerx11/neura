# Security incident record

This file records credential incidents without storing secret values, private
configuration, or identifying token material.

## GH-2026-001 — GitHub token stored in local Claude configuration

Status: **Awaiting owner revocation confirmation**

Detected: 2026-07-21

Affected scope: one GitHub token was stored in the local
`mcpServers.gfi-scout.env.GITHUB_TOKEN` field of `%USERPROFILE%\.claude.json`.
Available evidence does not show the value entering Neura source, Git history,
or a published release asset.

Containment and evidence recorded on 2026-09-03:

- The plaintext property was removed from `.claude.json`; a non-disclosing
  follow-up check found no `GITHUB_TOKEN` property or GitHub-token-shaped value.
- GitHub CLI authentication still succeeds through the Windows credential
  manager after the local property removal.
- Gitleaks `8.30.1` scanned all 56 repository commits with full redaction and
  found no leak.
- Release `v2.5.1` has no uploaded binary assets. Its generated source archives
  derive from the scanned tag and history.
- CI now scans complete history on pushes and pull requests. Regression tests
  prove clean history passes and a committed synthetic token fails.

Remaining closure evidence:

- The repository owner must confirm that the exposed token was revoked and
  replaced, and that no known log or screenshot copy remains.

Never add a token value, fingerprint, command line, or private file content to
this record, an issue, a pull request, or CI output.

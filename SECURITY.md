# Security policy

## Supported source

Only current `main` receives security fixes. It is a Mastra development/testing
build with Work, Learn and unrestricted YOLO, not an approved production or multi-user boundary.
Use synthetic, non-sensitive data while license/distribution approval remains
unresolved. Historical `v2.5.1` and the withheld Pi candidate do not describe the
active application. See [status](docs/STATUS.md).

## Report a vulnerability

Use [Security > Report a vulnerability](https://github.com/Rajveerx11/neura/security/advisories/new)
to open a private advisory. If private reporting is unavailable, contact the
repository owner through GitHub without exploit details and request a private channel.

Name the source commit and affected boundary. Describe the impact and provide a
safe reproduction, with any suggested fix. Never include real credentials or
private user data. The maintainer
will validate scope, coordinate a fix and publish a redacted advisory when practical.
No fixed response-time or embargo guarantee is offered.

## Credentials and private state

- Never commit credentials, `.env` files, authorization callbacks, memory,
  sessions, approval records or raw provider responses. Tests use synthetic values.
- Subscription tokens live in Neura's private home, not Pi's profile. Inspect
  effective Windows DACLs on the home and credential file before real login. The runtime does not independently enforce DACL privacy.
- API keys belong in the explicit provider's environment. Subscription access
  never falls back to separately billed APIs. Logout removes the local credential
  and does not claim remote revocation.
- Neura home and workspace must be disjoint, including linked ancestors. Pi
  profiles cannot be workspaces. No legacy credentials or history are imported.
- Revoke/rotate any exposed credential. Deleting a visible copy is insufficient.
  Record value-free closure in [security incidents](docs/SECURITY_INCIDENTS.md).

## Active Work boundary

Structured file tools use canonical junction-aware containment, protected-path
checks and original-byte hashes. Redacted contents cannot be rewritten as if they
were the original file. Root project instructions are bounded untrusted user
context. They cannot widen policy and are not saved in conversation history.

`work_exec` runs only in network-disabled WSL2/bubblewrap. Policy-allowed commands
can run without a prompt when `.git` exists, including headless. These commands
can execute model-written project code, so isolation holds the boundary. Other
permitted commands require exact typed approval. Headless approval fails closed.
Common dependency installations are refused with a manual command. Missing
isolation never falls back to host execution.

The sandbox masks secret-named files and protects `.git`, `.github`, `.husky` and
`.vscode` at any depth. Newly created protected paths are removed after execution. Incomplete inspection/cleanup reports failure and requires manual inspection
before host tools are run. Gitfiles are refused at any depth. Regular files with
multiple hardlinks are refused. Symlinks are permitted only in dependency roots
under the documented restrictions. Every structured `.github/` write requires
typed approval with the complete visible action.

Git-ignored files without secret names can remain readable to commands. Generated
project code will run with host permissions if the user later executes it outside
the sandbox. Review that diff. Broad private-name exclusions can also block
ordinary project folders such as `memory` or `sessions`.

## Active Learn boundary

Learn exposes four dedicated learning tools plus bounded public-workspace
`read`/`ls`. It has no generic shell/mutation, web search, MCP or integration tool.
Its writers use marked owned stores, bounded exclusive files and canonical
path/handle checks. Imported documents, profiles and saved excerpts are untrusted
data. Citation checks establish source/excerpt identity, not semantic correctness.

PDF/PPTX parsers have deadlines and heap bounds but trust native/WASM code. They are not OS sandboxes. SQL exercises use disposable in-memory SQLite with
authorizer/limits and no host file/network access. HTML boards escape content
and use fixed CSP. Worked answers remain visible in their source.

First Learn-store creation requires native Windows. Same-user hostile path
replacement remains an application-level limit. Optional Obsidian capture uses
only a configured, marked `Neura/` subtree with minimized append-only events. Raw answers/full transcripts are omitted. Plaintext files and SHA-256 envelopes
are not encrypted or authenticated against the signed-in user. Obsidian/plugins
can sync them independently. Network-backed vaults are unsupported.

Save/resume is explicit. Restored excerpts require reimport for new citations.
Browser actions return through user-copied revision-bound commands. Async
generation checks prevent stale state/warnings, but completed artifacts/events
can remain after cancellation. There is no atomic transaction across stores.

## Reviews, proof and recovery

Deterministic policy outranks model output. Work reviewers have enforced read-only
tools. The default model is same-family and labelled accordingly. Their candidate
receipts become stale after edits and never authorize committing or publishing.
Quick proof is detector-only. Full trusted proof is unavailable and every active
proof receipt retains `verified:false`. See [verification](docs/VERIFICATION.md).

History/crash locks fail closed. Durable recovery of uncertain effects is
unfinished. Inspect effects before retrying. Do not steal locks, discard invalid
audit tails or delete private state to force success. Pattern redaction cannot
recognize every secret.

## YOLO has no boundary

YOLO is an explicit opt-out from everything above, with the same meaning as
OpenAI Codex `--yolo`. The agent acts with the signed-in user's full authority:
no sandbox, no approvals, no path or secret checks, network on, and the full
inherited environment. It can read and change `.env`, `.git`, `.github`, other
projects and Neura's own checkout. Prompt injection in a file, a web page or
command output can use all of that.

Secrets are readable, and anything the agent reads may reach the model provider and saved session history. Tool data is not redacted; only the one-line terminal
notice for a command is. Neura has no undo or checkpoint for it. Use YOLO only on
repositories you trust.

Entry needs `--yolo` at startup or a typed `yes` for `/mode yolo`. ACP clients
enter through `session/request_permission`. A client that auto-answers permissions
will enter YOLO without asking a person. The mode is never saved. Every YOLO tool
call rejects a changed mode or session. That fence stops stale calls and is not a
containment boundary. A timeout or abort kills the command's process tree, but on
Windows a descendant whose parent already exited can survive. If Neura itself is
killed, a running command keeps going. A report that YOLO
can do what the user can do is not a vulnerability.

## Historical modes and release gates

Plan, Human Away, Gmail/MCP, private memory, checkpoints and old skill
discovery are unavailable in the active CLI. Their retained source does not
establish current authorization or parity. Historical Plan confidentiality and
Human Away preview obligations remain tracked by the [parity matrix](docs/PARITY_MATRIX.md)
and [production-readiness backlog](docs/PRODUCTION_READINESS.md).

A framework change does not close original hardening issues. Production claims
require applicable P0 and security-critical P1 acceptance, adversarial tests,
dependency trust, credential closure, clean-host install/recovery evidence and
reviewed release approval. Public source, green tests and version metadata do
not waive these gates. See [release policy](docs/RELEASING.md).

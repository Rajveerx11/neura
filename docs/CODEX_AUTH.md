# ChatGPT subscription adapter

Development/testing only. On 2026-10-26 the owner reported that `/login` completed,
but the first model request returned HTTP 400. This is not successful end-to-end
subscription or entitlement evidence. Automated checks remain synthetic.
Mastra's existing EE/distribution gate remains open. See
[dependency review](MASTRA_V1_DEPENDENCIES.md) and [status](STATUS.md).

## Before a manual subscription test

Use only synthetic, non-sensitive development/test data while the Mastra license
gate remains unresolved. Do not start sign-in merely to check installation:
`neura --help`, `neura --check` and `install.ps1 -Check` need no credentials or
model calls. They do not verify login, refresh, entitlement or Windows DACLs.

On Windows, inspect the actual Neura home ACL before `/login`. Confirm that it is
owned by the intended user and that effective access is limited to that user
and trusted administrative principals such as SYSTEM and local Administrators.
Check for unexpected inherited grants. Profile inheritance alone is not proof.
If `codex-auth.json` already exists, inspect its ACL metadata too, never its
contents. After a user-authorized first login, verify the created file's ACL
without displaying tokens. Neura does not independently enforce Windows DACLs.

If the home is shared or its permissions are unclear, stop before login. Have
the owner or administrator prepare a separate private home and verify its DACL.
Do not recursively change an existing state directory or move its private data.
An explicit `NEURA_HOME` must be absolute, nonlinked and disjoint from the
workspace in both directions. Keep it outside Pi profiles. Keep test workspaces
outside the Neura runtime checkout and its ancestor/descendant directories.

Start `neura --provider openai-codex --model gpt-5.5 --no-history` in a disposable
workspace, then enter `/login` explicitly. The authorization URL and callback
are sensitive: do not paste them into bug reports. No real-account login,
reduced-scope acceptance, refresh or model entitlement is claimed by the
synthetic tests. Confirm those separately with the owner's consent. A model
request sends the prompt and any selected tool/document content to the provider.
`--no-history` does not disable credential or Learn-store writes.

Subscription access and API billing are separate. Explicit OpenAI/Anthropic API
selection can incur API charges. A ChatGPT subscription does not cover those
charges. Subscription errors never trigger API fallback. To test without
subscription credentials, explicitly select an already running loopback local
model and use synthetic data. No agent should initiate login, logout, refresh,
provider calls or changes to OAuth grants as part of installation checks.

## Safe rejection diagnostics

Unsuccessful model responses are read only as JSON, with an 8 KiB limit and a
one-second read deadline. Recognized model, request-field and quota categories
produce fixed hints. A request field is shown only if it matches the built-in
public field allowlist. Raw messages, arbitrary codes, prompts, account IDs,
headers and tokens are never printed. Unknown, malformed, oversized and stalled
errors keep only the status and an explicit unknown-reason notice. Cancellation
still aborts the request. Classification never retries, changes a model, starts
login or enables API billing.

We inspected the default Work request with synthetic credentials and an
intercepted fetch. It had nonempty instructions, `stream:true`, `store:false`,
non-strict tools and no `max_output_tokens` field. That rules out this field in
the captured default request. It does not rule out other backend rejections.
The actual cause of the owner's 400 remains unconfirmed. A recognized safe hint
from a manual retry may narrow the investigation, but does not prove the cause
or establish provider access.

Regression coverage includes structured and detail-string hints, both generation
paths and suppressed private markers. Negative cases cover exact field tokens,
untyped codes, unrelated model text, byte/time limits, continuously fulfilled
empty reads, malformed or non-JSON bodies, and abort during an error read.
Empty chunks are not retained, and a monotonic deadline supplements the timer.
No real credentials or model calls are used.

## CLI integration

`src/auth.ts` exports:

```ts
loginCodex({ onAuthorize, signal? }): Promise<void>
logoutCodex(): Promise<void>
```

`onAuthorize(url: string)` displays or opens the browser URL. Login resolves only
after a valid callback, token exchange, and credential write. The parent CLI must
call it only for an explicit interactive `/login`, never at startup or after an
authentication failure. `/logout` should call `logoutCodex()`. Neither function
prints secrets or launches a browser itself. Abort signals close the callback
server. Logout cancels pending authentication operations before deleting the
local credential. Logout does not remotely revoke the OAuth grant or cancel an
already-dispatched inference request.

`createConfiguredModel({ provider: 'openai-codex', model: 'gpt-5.5' })` remains
synchronous. Construction performs no credential reads, login, or network calls.
Each actual request loads Neura credentials and refreshes them if they expire
within a minute. The existing local, OpenAI API, and Anthropic API transports
remain separate. Subscription authentication never uses `OPENAI_API_KEY`, an
ambient OpenAI base URL, or the API-billed endpoint. A custom subscription
`baseURL` is rejected. The parent retains the `gpt-5.5` model default.

The parent owns CLI integration for `openai-codex`, `/login`, and `/logout`.
The synthetic missing-credential test proves request-time denial without API
fallback. The parent updated the runtime test to assert inert construction and
reject custom subscription endpoints.

## Credential and callback boundaries

Only `NEURA_HOME` or the default `~/.neura` is used. An explicit home must be
absolute. `codex-auth.json` contains the version and account ID alongside access
and refresh tokens with their expiration. It contains no callback code, PKCE
verifier, ID token or email. There are no Pi package imports, credential-store imports, profile
fallbacks, or environment-driven test shortcuts.

Every existing path ancestor is checked before use. Symbolic links, junctions,
linked credential files, non-regular files, and lexical/canonical `.pi` paths
(including case/trailing-dot variants) are rejected. Reads are bounded to 128 KiB.
New directories/files request modes 0700/0600. POSIX group/other permissions are
rejected. **Windows mode bits do not establish a private DACL.** The default home
inherits the user's profile ACL. An explicit home must already have an appropriate
owner-only ACL. These tests do not certify Windows ACL isolation, encryption at
rest, protection from another process running as the same user, or hostile
concurrent filesystem replacement. Do not put `NEURA_HOME` in a shared directory.

Authentication changes serialize in-process. An exclusive `codex-auth.lock`
directory prevents two Neura processes from rotating or replacing the same
credential concurrently. A crashed process can leave a lock: recovery is manual,
only after confirming no authentication operation still owns it. No lock is
removed automatically. Writes use a flushed exclusive temporary file and rename.
Refresh writes the rotated refresh token before inference can proceed. Once a
validated refresh completes, caller cancellation or its timeout does not discard
the rotated credential. The caller still receives cancellation and inference is
not dispatched. Explicit logout cancels persistence, including a final check
before publication, and removes the local credential. Refresh failure or an
account identity change denies the request.

The callback server binds only `127.0.0.1`, first port 1455 then 1457. It never
cancels another listener or accepts manually pasted codes. The redirect URI uses
`http://localhost:<port>/auth/callback`, as in the audited protocol. Callback GETs
must have that exact path, a loopback Host with the bound port, one matching
256-bit state, and one code. The code is consumed once. Browser denial, abort,
callback timeout (10 minutes), and token-request timeout (15 seconds) clean up the
server and lock. Diagnostics do not echo callback codes, token bodies, or raw
provider error bodies. OAuth and inference redirects are rejected.

Token responses must be bounded JSON with nonempty header-safe access and refresh
tokens, a finite positive expiry, and a ChatGPT account ID. JWT claims are decoded
only as metadata from the TLS token response, not as locally verified signatures.
Expiry is bounded by both `expires_in` and access-token `exp` when present.

## Subscription transport

The audited protocol defines:

- Client ID `app_EMoamEEZ73f0CkXaXp7hrann`, authorization at
  `https://auth.openai.com/oauth/authorize`, and code/refresh exchange at
  `https://auth.openai.com/oauth/token`.
- OAuth S256 PKCE and state. Neura requests only `openid profile email
  offline_access`. The source also requests connector scopes, but supplies no
  evidence that subscription chat requires them. Neura omits those scopes because
  it exposes no connectors. Live acceptance of this reduced scope is unverified.
- Inference only at `https://chatgpt.com/backend-api/codex/responses`, with OAuth
  Bearer authorization and `ChatGPT-Account-ID`.

The pinned OpenAI SDK performs Responses prompt/tool/image serialization. Neura
sets `store:false` before SDK history conversion, preventing references to
server-stored items, and enforces it again on the wire. Current system/developer
messages become the backend `instructions` field. Tool calls/results and native
user/tool image parts stay in the input. Requests always set `stream:true` and
subscription-only headers. The internal placeholder API key is never sent.

Streaming calls use the SDK SSE parser. Non-streaming calls collect a bounded
8 MiB SSE response and require an authoritative `response.completed` snapshot.
A malformed or truncated stream cannot become a successful non-streaming turn.
Failed and incomplete responses are also rejected. Stream cancellation propagates to the reader. This is a
protocol adapter, not evidence of live subscription entitlement or model access.

## Source and license evidence

Public inspection only, in `%TEMP%\neura-codex-audit`. No SDK installation or
execution. `npm pack @mastra/code-sdk@1.15.0 --ignore-scripts` was checked against
the registry SHA-512 integrity:

```text
sha512-8Nm7ih5X/ouOQuE5Rk01P3K2Pbjy+hdOn1Z5JWsVkzuc/b6GvuxuiXkZrDbaUiDWF+oYDlX+STHZ3X/vyDVkjA==
```

Both published source maps' embedded TypeScript match these files byte-for-byte
at release commit `4c22623ea342a0ce611e15f89f4ab8b377bf7ee8`:

- [OAuth protocol source](https://github.com/mastra-ai/mastra/blob/4c22623ea342a0ce611e15f89f4ab8b377bf7ee8/mastracode/sdk/src/auth/providers/openai-codex.ts)
- [Provider/stream source](https://github.com/mastra-ai/mastra/blob/4c22623ea342a0ce611e15f89f4ab8b377bf7ee8/mastracode/sdk/src/providers/openai-codex.ts)

The artifact's `LICENSE.md` attributes non-EE content to Kepler Software, Inc.,
copyright 2025, under Apache-2.0. It reserves EE and incorporated third-party
components under their respective terms. No package NOTICE file was present.
Registry signature metadata was retrieved, but this package's signatures were not
independently verified. Integrity/source correspondence is not signature or
license-distribution approval.

The upstream auth module credits Pi OAuth inspiration. Its transport credits
OpenCode. Neura uses those reviewed protocol details with a newly written
store/callback/transport boundary. No Pi source or SDK module was copied or
imported. No broad code-sdk dependency graph, new runtime package, or entitlement
bypass was added. The existing Mastra core license blocker remains unchanged.

## Synthetic verification

Windows Node 24.19.0:

```powershell
node --test tests/v1-auth.test.ts
npm run typecheck:v1
```

On 2026-10-27 both exit 0: 19 auth tests and strict TypeScript. Tests create temporary Neura
homes, intercept every provider/token request, and use only synthetic loopback
callbacks. Coverage includes PKCE, callback host/path/state/duplicates/replay,
browser denial, abort/logout cleanup, malformed/expired tokens, refresh rotation
and account mismatch, request headers/body, fragmented SSE, text streaming,
actual Agent tool dispatch, native images and encrypted reasoning history. Path
checks cover linked ancestors/files and hardlinks. Lock contention is also tested. No real login, private profile read,
provider call, approval grant, commit, or remote mutation ran.

The historical specialist checkpoint passed 26/26 combined auth/runtime tests
with a 13-suite aggregate. The current active aggregate contains 14 suites.
See [combined verification records](MASTRA_V1.md#evidence-and-remaining-gates)
and current CI for their exact scope. Historical counts are not current evidence.
LSP diagnostics were unavailable (`typescript-language-server` missing); strict
`tsc` is the available type evidence.

The CLI and Work factory refuse workspace/private-home overlap before history or
authentication. Missing home paths resolve their nearest existing ancestor before
comparison; linked home ancestors fail closed. Synthetic regressions cover a
missing home below a junction and verify the CLI creates no history there. Pi
profile roots cannot be workspaces, and `codex-auth.json` is reserved from public
reads, listings and writes. These boundaries do not certify Windows ACL privacy.

OCR delegation preview/rules were fetched before and after implementation. The
final scoped review covers nine files. The other 41 previewed files are explicitly
skipped as parent-owned migration work outside this task. Per-file accounting is
in `%TEMP%\neura-auth-review-accounting.json` (the initial preview covered six
reviewed files and 36 skipped files). This is a scoped review, not a clean review
of the combined migration.

Actionable parent follow-up:

- **Medium, hardening limit:** `src/auth.ts:28` enforces POSIX mode privacy only.
  Windows ACL isolation remains unverified. Before real login, use a private home
  with an owner-only DACL. A shared-home deployment needs explicit DACL enforcement.

## Session boundary review for the parent

Native Windows path resolution accepts equivalent 8.3 spellings for CLI
workspace/home containment. Session and Learn directory checks inspect actual
components for links/junctions rather than rejecting a different spelling. The
canonical private home is still checked against `.pi` before Learn configuration
is read. These checks do not certify hostile concurrent filesystem replacement.

The new CLI workspace hash separates default history directories. Its exclusive
session lease covers the lifecycle from resume through effects to save. Together
they address accidental cross-root resume and competing CLI writers without
changing the session format.

The lower-level `saveSession`/`appendSession` helpers in `src/session.ts` still
have a documented single-writer ceiling: two callers can load the same
revision and the later save can overwrite the earlier history. A temporary-home
reproducer saved synthetic A then stale B and confirmed that only B remained
(exit 0). This is a low-severity API contract limit, not a reproduced lease bypass
in the new CLI. They also accept an arbitrary explicit
session directory with no workspace field in the envelope. Keep every CLI writer
under its lease and retain workspace-scoped directories. If another entry point
starts writing sessions, require those same boundaries there or add a revision
check and workspace identity to the store contract. No parent-owned session or
CLI files were edited here.

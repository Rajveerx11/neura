# T3 Code local development provider

Neura integrates with T3 Code as a **Local ACP command**, not as Pi, a renamed
built-in provider, or a public ACP Registry distribution. This is a source-linked
Windows development integration, not a production release. Existing Mastra
licensing/distribution gates remain in force.

## Register this checkout

Run on the native Windows machine hosting T3 Code, with Node.js 24.15+ and both
locked dependency graphs already installed:

```powershell
node --test tests/v1-acp.test.ts
node scripts/register-t3.mjs --apply
node scripts/register-t3.mjs --check
node scripts/register-t3.mjs --probe
```

With T3 Code running, registration creates only `providerInstances.neura`
through its serialized `server.updateSettings` API (`operation: create`), never
by replacing `settings.json`. It uses `T3CODE_HOME` when configured, otherwise
`~/.t3`. The instance uses driver `acpRegistry`, display name `Neura`, source
`local`, the current native `node.exe`, and one literal argument: the absolute
path to `src/acp.ts`. Existing providers, defaults and credentials are not
replaced. An existing, different Neura registration is refused, including one
created concurrently by another client.

The script uses T3's installed CLI to issue a two-minute session restricted to
`settings:write` and `providers:manage`, keeps its bearer token in memory,
exchanges it for a one-use local WebSocket ticket, then revokes the session in
`finally`. It does not read existing credentials or print/store tokens. It
requires a native loopback server and never changes remote environments. If
revocation fails, it reports the two-minute expiry; it does not revoke anyone
else's sessions. `--check` reads registration metadata only and issues no token.
`--probe` requests T3's real Neura-only provider refresh using a short-lived
`orchestration:read` session, revoked the same way, and fails unless T3 reports
`ready`. T3's discovery client exercises the real CLI in an empty temporary
workspace with history disabled, since the host's discovery cwd may contain
Neura's private account store. Discovery cannot run tasks and removes its empty
workspace on disconnect; normal sessions retain private-home containment.

Alternatively, follow **Settings → Providers → Add provider → Show more → Local
ACP command** and enter those same executable/argument values. Select Neura for
a new thread. The API publishes the change to the running app; the script never
restarts T3 Code or interrupts another agent. To undo registration, remove only
the Neura provider in Settings. Neura's account and history stay untouched.

This points at source, so local edits affect subsequent launches. Moving or
removing the checkout breaks the registration. No global package, Pi extension,
public registry entry, version bump or remote mutation is needed.

## Provider discovery and official logo

A registered local command appears as **Neura** in Settings → Providers and the
provider/model picker. It does not become a built-in driver or an ACP Registry
search result. Check the selected environment: registration belongs to the
Windows T3 server, not every linked machine. `--check` confirms the stored
registration only; it does not prove live inference or logo rendering.

The approved Neura symbol is [`assets/brand/neura-mark.svg`](../assets/brand/neura-mark.svg).
Do not substitute the Pi logo or treat a project icon as the harness logo.

T3 currently has no supported custom-logo setting for local ACP commands.
Its provider-instance schema has no icon field, and its ACP icon loader accepts
only credential-free HTTPS URLs on `cdn.agentclientprotocol.com`. A local path,
`file:` URL, data URL or GitHub-hosted SVG will not render through that loader.
Adding an `icon` property to this registration or to ACP initialization will not
make T3 display the Neura mark. The generic ACP icon remains; **official-logo
display is blocked**, not complete.

A supported solution needs either T3 support for local-provider icons or an
approved public ACP Registry entry carrying the official artwork. Public
registration/distribution remains outside this development integration and
blocked by Neura's existing licensing gates. Do not patch the installed T3 app,
weaken its icon URL restrictions or invent a registry agent ID.

This limitation was checked against T3's official documentation and source at
[`8e6a7323050ea8d2891f745f7e624e84f9fd8d9a`](https://github.com/pingdotgg/t3code/tree/8e6a7323050ea8d2891f745f7e624e84f9fd8d9a):

- [Local ACP command settings](https://github.com/pingdotgg/t3code/blob/8e6a7323050ea8d2891f745f7e624e84f9fd8d9a/packages/provider-acp-registry/src/settings.ts)
- [Provider-instance fields](https://github.com/pingdotgg/t3code/blob/8e6a7323050ea8d2891f745f7e624e84f9fd8d9a/packages/contracts/src/providerInstance.ts)
- [Allowed ACP icon URLs](https://github.com/pingdotgg/t3code/blob/8e6a7323050ea8d2891f745f7e624e84f9fd8d9a/packages/contracts/src/acpRegistry.ts#L13-L42)
- [Provider icon rendering](https://github.com/pingdotgg/t3code/blob/8e6a7323050ea8d2891f745f7e624e84f9fd8d9a/apps/web/src/components/chat/ProviderInstanceIcon.tsx)

## Accounts and models

Registration explicitly selects `NEURA_PROVIDER=openai-codex`. Neura uses its own
normal `NEURA_HOME` / `~/.neura` account and session store, never Pi's profile.
This instance and the native Neura terminal share that Neura account unless you
explicitly set a separate `NEURA_HOME` in T3's provider environment settings.
Do not copy credentials into T3 configuration.

Sign in explicitly with `/login` in the native Neura terminal before using
subscription inference. The ACP adapter does not advertise an unimplemented T3
sign-in flow. Initialization and session creation do not contact a model, start
login, or assert entitlement. The default model is selected from Neura's
subscription catalog on the first task, just as in the native CLI.

For a fixed model, set `NEURA_MODEL` in this provider instance and start a new
thread. For a local model, explicitly change `NEURA_PROVIDER` to `local` and set
`NEURA_MODEL` and the loopback `NEURA_BASE_URL`. API providers require explicit
selection and their separate credentials; subscription failures never fall back
to API billing. Do not assume account isolation between two provider instances.

## Supported behavior and limits

- ACP v1 over newline-delimited JSON-RPC on stdin/stdout. Negotiation declines the
  v2 preview honestly. Protocol stdout contains no logo or terminal banner.
- Persistent, in-process Work/Learn state and multi-turn conversation history,
  using the existing CLI loop, Learn service, review workflow and Neura-owned
  session writer lease. No duplicate agent loop or new runtime dependency.
- Text and resource references; references do not authorize outside-workspace
  reads or automatic URL retrieval. Images, audio and embedded resources are
  rejected rather than silently lost.
- Work, Learn and YOLO mode selection, assistant text, provider-exposed reasoning
  summaries and payload-free tool lifecycle cards. Plan is not implemented.
  Every mode change, including a typed `/mode`, sends `current_mode_update`.
- Selecting YOLO goes through `session/request_permission` first and holds the
  session busy, so a prompt cannot start during it. Denial, cancellation or
  disconnect returns an error, keeps the mode and sends no update. T3's thread
  permission mode may answer automatically: a thread set to allow everything
  enters YOLO with no person asked. YOLO means no sandbox, no approvals, network
  and full account access on this machine. Secrets are readable, and anything the agent reads may reach the model provider and saved session history. The discovery probe cannot
  enter it.
- Exact-action ACP `allow_once` / `reject_once` requests for operations that
  Neura requires approval for. Unknown options, cancellation and disconnect deny
  pending requests. Neura revalidates its existing policy after approval. T3's
  thread permission mode may answer requests automatically; use Supervised when
  you want to approve each such request yourself.
- Stop cancels the current turn without replay. Only one prompt may run at a time.
  Disconnect waits for the interrupted operation before releasing its writer lease.
- In Work, the native offline WSL2/bubblewrap command sandbox remains mandatory. No T3
  terminal execution or host fallback bypasses it. This isolates Work commands,
  not model inference: Neura's selected provider transport can use the network.

External MCP servers are **not connected** in this first development adapter;
a session receiving them reports that limitation. It does not claim HTTP/SSE MCP
capabilities or expose T3 tools to the model. Native ACP load/resume/fork,
rollback of conversation state, background subagents, model switching within a
thread and usage reporting are not advertised. T3's portable handoff may start a
new session; this is not native session restoration. Use the native terminal for
account and history management. Maintained regression tests are source, not
cleanup targets.

## Diagnose setup without changing private state

| Check or symptom | Meaning and next step |
| --- | --- |
| `node scripts/register-t3.mjs --check` passes | Stored executable and arguments match this checkout, and `NEURA_PROVIDER` selects `openai-codex`. Extra environment settings are not validated. No model is launched |
| `node scripts/register-t3.mjs --probe` reports `ready` | T3 created a real discovery session. Inference, entitlement and command-sandbox acceptance are separate checks |
| Neura is missing from the picker | Check the selected T3 environment and Settings → Providers. Registration is local to the Windows server |
| Test-session creation fails | Confirm native Node 24.15+, both dependency graphs, the checkout path and `src/acp.ts`. Run `--check`, then `--probe`; do not edit unrelated providers or reset T3 settings |
| A normal thread rejects its workspace | Choose a disposable project disjoint from `NEURA_HOME` and Pi profiles. Work commands also refuse a workspace overlapping Neura's running checkout |
| Subscription inference fails after discovery passes | Follow [account setup and safe diagnostics](CODEX_AUTH.md); `ready` does not establish entitlement. Do not copy tokens into T3 or switch to paid APIs implicitly |
| A Work command is unavailable | Check WSL2/bubblewrap and the project toolchain. There is no host-execution fallback |

The [architecture diagram](ARCHITECTURE.md#system-overview) shows which parts are
shared with the native CLI. The [Learn visual tour](LEARN_MODE.md#visual-tour)
shows the separate local browser boards, not T3's own interface.

## Verification

`tests/v1-acp.test.ts` runs the real native CLI and Mastra loop against an isolated
synthetic local model. It covers version negotiation, provider-free setup,
workspace/session validation, retained multi-turn history, Work/Learn selection,
permission allow/deny/invalid/cancel, tool cards and interrupted inference.
It does not establish live subscription entitlement or full T3 feature parity.
The harness includes the `acp` suite; the Pi-free gate also traces `src/acp.ts`.

## References

- [T3 Code ACP providers and local commands](https://github.com/pingdotgg/t3code/blob/main/docs/user/providers-acp.md)
- [T3 provider integration requirements](https://github.com/pingdotgg/t3code/blob/main/docs/internals/adding-a-provider.md)
- [ACP initialization](https://agentclientprotocol.com/protocol/v1/initialization)
- [ACP session setup](https://agentclientprotocol.com/protocol/v1/session-setup)
- [ACP prompt lifecycle](https://agentclientprotocol.com/protocol/v1/prompt-turn)

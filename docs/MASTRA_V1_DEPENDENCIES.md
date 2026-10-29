# Neura v1 runtime dependency and integration handoff

Reviewed locally on 2026-10-24 using Windows Node 24.19.0. This is a development
slice, not a release or subscription-authentication parity claim. Root metadata
remains `2.6.0-rc.1`. Only the root active dependency graph was replaced; historical
Pi source and parent-owned migration work are outside this slice.

> This records the initial runtime-specialist handoff. Its earlier failures and
> next-specialist notes remain dated evidence, not current setup instructions.
> For the integrated CLI and subscription adapter, use [Mastra v1](MASTRA_V1.md)
> and [current authentication guidance](CODEX_AUTH.md).

## Exact graph

| Direct runtime package | Version | Purpose |
| --- | --- | --- |
| `@mastra/core` | `1.79.0` | Real Agent execution and tool dispatch |
| `@ai-sdk/openai` | `4.0.96` | Explicit OpenAI Responses API and local Chat Completions |
| `@ai-sdk/anthropic` | `4.0.82` | Explicit Anthropic Messages API |
| `typebox` | `1.4.3` | Existing Learn schemas and final callback validation; updated in PR #134 |
| `zod` | `4.6.7` | Mastra peer and reused Learn validation |

Development pins remain `@types/node@26.6.5`, `typescript@7.0.2`,
`playwright-core@1.64.0`, and `axe-core@4.14.0`. Browser pins are retained for
parent-owned Learn verification. Existing test scripts remain for parent migration;
this slice adds `test:v1:runtime` and `typecheck:v1` only.

Both provider versions depend on `@ai-sdk/provider@4.0.29` and
`@ai-sdk/provider-utils@5.0.62`, matching Mastra's v7 aliases. Newer provider
contracts are not interchangeable merely because their major versions match.
`package-lock.json` contains resolved versions and SHA-512 integrities for the
entire graph, including platform-specific optional packages. No floating direct
pins, Pi namespaces, `pi-subagents`, `pi-mcp`, or `pi-tui` remain in that lock.

Installation used `npm install --ignore-scripts --no-fund`. Lock inspection found
no `hasInstallScript` packages. This does not establish absence of WASM or other
executable content. Runtime core still has a sizable transitive graph; no claim of
exhaustive transitive source review is made.

## TypeBox 1.4.3 dependency update (PR #134)

The root pin advances from `1.3.36` to exact `1.4.3`. No other package identity
changes. Both npm tarballs were downloaded for inspection, not executed. Their
SHA-512 hashes matched registry metadata. The new hash also matched the lock:

```text
typebox@1.4.3
sha512-u3nyf7ZciAv1GOijVpI0TDt9At5wmEi7lSHSlRrnjuThv1DcB7fgGBqqrz+fGZ54jAfTpOOX0JXwxSIg3pnxQA==
```

The published manifests retain identical exports and `typesVersions`, including
`typebox` and `typebox/value`. Neither artifact declares dependencies or lifecycle
scripts. The MIT license is byte-identical, with Haydn Paterson's 2017-2026
copyright notice. Root and Learn installation used `npm ci --ignore-scripts`.

Source review compared the published artifacts and inspected upstream tag
[`1.4.3`, commit `ed9d84abeaec53af8da0bdc45c107e0eb5189de8`](https://github.com/sinclairzx81/typebox/tree/ed9d84abeaec53af8da0bdc45c107e0eb5189de8).
The tag's [changelog](https://github.com/sinclairzx81/typebox/blob/ed9d84abeaec53af8da0bdc45c107e0eb5189de8/changelog/1.4.0.md)
documents shared subschema references in 1.4.0, faster hashing in 1.4.1,
Pick/Omit modifier retention in 1.4.2, and RFC 9557 date-time suffix support in
1.4.3. GitHub's release endpoints returned 404 for both `1.4.3` and `v1.4.3`.
The tag and source changelog, rather than a release object, supply release evidence.

`Value.Check`, schema Check and its dispatch module are byte-identical between
artifacts. The changed additional-properties fast-path guard belongs to compiled
validation. Neura uses interpreted Check, not Compile, coercion or repair.
The adapter already JSON-copies schemas before recursive closure, avoiding the
new shared-reference mutation risk. Added runtime regressions exercise nested
objects, arrays and union branches through real Mastra dispatch and direct/resumed
execution. They check rejected extras, unchanged inputs and schema definitions,
and explicitly schema-valued additional properties. Concurrent resumed calls
also check ordered effects and cancellation of queued callbacks. Existing runtime
and Learn tests retain callback-authority checks and cover termination as well
as cancellation.
No runtime schema or accepted-input policy changed.

This is a targeted compatibility review, not a reproducible-build attestation or
an exhaustive upstream audit. No real provider/subscription calls or live install
were used. Mastra licensing and distribution remain blocked as described below.

## Source and artifact review

Exact npm metadata and tarballs were inspected before installation. The core
artifact agrees with the prior audit's integrity:

```text
@mastra/core@1.79.0
sha512-8E3+Ct9RihoIc+Q5FPzGVs5uZOdubIZs78EXiK3VvPSESEc5dhBTJmfO1DSU23Qmv8qoe2Gh5QKaztjKeF2mwQ==
```

Review covered package exports, dependency metadata, licenses, Agent/tool contracts,
telemetry gating, final callback validation, tool-output mapping, and provider
construction/request conversion. TypeBox's `Value.Check` delegates to its schema
checker without coercion. The adapters' shipped source was checked for API-key
environment access, endpoint defaults, request headers, and image serialization.
Relevant upstream reference: [Agent.generate](https://mastra.ai/reference/agents/generate).
Release source is anchored at Mastra commit
[`4c22623ea342a0ce611e15f89f4ab8b377bf7ee8`](https://github.com/mastra-ai/mastra/tree/4c22623ea342a0ce611e15f89f4ab8b377bf7ee8).

**Distribution remains blocked:** core's shipped `LICENSE.md` excludes EE content
from Apache-2.0, and the prior source audit found bundled EE authentication code
reachable from Agent imports. The release's
[EE license](https://github.com/mastra-ai/mastra/blob/4c22623ea342a0ce611e15f89f4ab8b377bf7ee8/ee/LICENSE)
requires separate resolution before distribution/production use. Local
development/testing is the authorized scope. No entitlement bypass was added.

An independent installed-artifact review confirmed the static import chain:
`dist/agent/index.js` → `dist/agent-tuAMgHe3.js` →
`dist/ee-XRuijAiF-d0ZlBQz1.js`. Agent imports FGA helpers from that shared EE
chunk even when no FGA provider is configured. Tool/logger-only imports do not
clear redistribution of the whole installed package. The release-pinned EE license
separates development/testing from production and redistribution; running locally
is not automatically development use. Keep the release gate blocked pending
copyright-holder clarification covering these shared helpers and delivery model,
or an upstream-supported EE-free artifact with reviewed attribution. Do not strip
entitlement checks or assume tree-shaking grants rights. Switching away from the
owner-selected Mastra engine requires owner approval.

`runtime.ts` sets `MASTRA_TELEMETRY_DISABLED=1` before dynamic Mastra imports.
It creates an `Agent`, never a `Mastra` instance, avoiding constructor-driven
license validation. No database, observability service, workspace, discovery,
native tools, or Mastra Code TUI is configured. A clean-environment child test
injects a synthetic license setting and rejects fetch, HTTP, TCP/TLS, and subprocess
calls during import and an actual deterministic Agent turn.

## Public contracts

`ToolDefinition` and `ToolResult` live in `src/runtime.ts`:

```ts
type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, any>;
  execute(input: any, context: { signal?: AbortSignal }): Promise<ToolResult>;
};
type ToolResult = {
  content: Array<
    { type: "text"; text: string } |
    { type: "image"; mimeType: string; data: string }
  >;
  terminate?: boolean;
};
runTurn({ model, messages, instructions, tools, signal?, onText? })
  // Promise<{ text: string; messages: any[] }>
```

The caller supplies the current user input in `messages`, current instructions,
and only authorized tools. Returned messages include supplied history plus the
new completed exchange. Tool calls serialize, turns stop after eight model steps,
and `terminate: true` blocks subsequent calls even within the same model batch.
Tool schemas reject unknown object fields by default and retain explicit schema
bounds. Validation repeats inside the execute closure, including direct/resumed
framework entry paths. Parent callbacks must still check current mode, generation,
canonical targets, approvals, and abort signals at every effect.
`createTurnTools(definitions, signal?)` exposes the same boundary for direct-path
tests; do not retain it across turns. `close()` revokes further callback execution.

Image results use Mastra's `toModelOutput` to become media content. Local Chat
Completions otherwise serializes tool images as JSON; its adapter extracts images
into a labeled user content block after the contiguous tool results. OpenAI
Responses and Anthropic receive native image content. Tests inspect actual
serialized HTTP request shapes using synthetic transports; no real vision-model
quality or service compatibility claim is made. User image messages should include
`mediaType` alongside `image` to avoid framework MIME defaults.

`createConfiguredModel({ provider, model, baseURL? })` supports:

- `local`: explicit loopback HTTP(S) `baseURL`, Chat Completions, dummy local key;
  never uses a remote API key as fallback.
- `openai`: `OPENAI_API_KEY`, HTTPS endpoint, Responses API.
- `anthropic`: `ANTHROPIC_API_KEY`, HTTPS endpoint, Messages API.
- `openai-codex`: integrated subscription transport in `src/providers.ts` and
  explicit login/refresh in `src/auth.ts`; Neura-only credentials, fixed endpoint,
  no API-billing fallback. See [current auth evidence](CODEX_AUTH.md).

API endpoint defaults are supplied explicitly rather than inherited from ambient
base-URL variables. URLs containing userinfo, query strings, or fragments fail.
No legacy or third-party credential store is read. Only explicit subscription
requests may access Neura's own credential store.

Session helpers in `src/session.ts` all require an explicit absolute directory:

```ts
createSession(directory: string): Promise<Session>
listSessions(directory: string): Promise<SessionSummary[]>
resumeSession(directory: string, id: string): Promise<Session>
saveSession(directory: string, session: Session): Promise<Session>
appendSession(directory: string, id: string, messages: any[]): Promise<Session>
```

`Session` contains `version: 1`, UUID `id`, ISO `createdAt`/`updatedAt`, and
provider-neutral `messages`. History is bounded to 200 messages and 1 MiB, trimming
old complete user turns. Oversized current turns and incomplete tool exchanges are
rejected. Only history is persisted; no instructions, callable tools, approvals, or
in-flight effects are restored. Resume must always create fresh current tools.
Writes use flushed temporary files and atomic rename. This is a single-writer
store; concurrent session writers require a future locking/version contract.
UUID traversal, linked session files, and lexical/canonical `.pi` directories are
rejected. OS ACL hardening and adversarial concurrent filesystem replacement are
not certified by these tests.

## Historical subscription-adapter investigation

The following records the core specialist's pre-integration review, not a current
missing-feature claim. The adapter was subsequently implemented without installing
code-sdk; [subscription authentication](CODEX_AUTH.md) is the current authority.

The maintained candidate `@mastra/code-sdk@1.15.0` exposes these real subpaths:

- `@mastra/code-sdk/auth/providers/openai-codex`: browser callback/device login,
  PKCE/state handling, token exchange, refresh, and account identity.
- `@mastra/code-sdk/providers/openai-codex`: `openaiCodexProvider`,
  `buildOpenAICodexOAuthFetch`, and injected `CredentialStore` support.

Its transport targets `https://chatgpt.com/backend-api/codex/responses`, handles
account headers and token refresh, and has streaming-specific requirements. An
ordinary OpenAI API key or changing `baseURL` alone does not implement that flow.
The default path constructs shared `AuthStorage`, so injection of a strictly
Neura-owned store is mandatory. The provider has a `NODE_ENV=test`/`VITEST` branch;
success through that branch cannot establish subscription operation. The auth
module identifies inspiration from Pi's OAuth implementation, so provenance must
be reviewed before claiming full independence from Pi-derived source.

This package was downloaded for source inspection only, not installed or executed.
Its dependency closure includes libsql, DuckDB, PostgreSQL, native AST tooling,
browser/embedding adapters, and additional Mastra packages. Deep imports do not
remove that installation graph. The next specialist must choose and review a
minimal maintained adapter boundary, resolve source/license scope, implement
explicit login and refresh with Neura-only credential storage, and test production
transport behavior with synthetic OAuth/SSE endpoints outside test-mode shortcuts.
Then the owner can perform a separately authorized real login. No real login,
token/store inspection, subscription request, or API-billed model call ran here.

## Historical core-specialist checkpoint

These results precede CLI/auth/installer integration. In particular, the failed
legacy wrappers below are not the current active verifier. Current combined
results, machine launcher state and remaining gates are in [Mastra v1](MASTRA_V1.md).

- `npm run typecheck:v1`: exit 0, strict scope covers the three owned source files
  and focused tests.
- `npm run test:v1:runtime`: exit 0, 14 tests. Real Agent dispatch, accepted and
  rejected input, direct/resumed validation, callback denial, abort, serial
  termination, step bounds, tool feedback, image conversion and session resume,
  local/OpenAI/Anthropic request images, session bounds/path rejection, and isolated
  telemetry/license network/process denial.
- `npm ls --depth=0`: exit 0; direct pins match the table.
- Lock assertions: exit 0; 175 locked package entries, no Pi packages, no lifecycle
  script markers, exact direct pins, unchanged root release version.
- `npm audit --audit-level=high`: exit 0, zero vulnerabilities.
- `npm audit signatures`: exit 0, 156 registry signatures and 42 attestations
  verified. Optional packages absent on this platform are not claimed verified.
- `git diff --check`: exit 0 at the scoped checkpoint.
- `node scripts/verify-harness.mjs`: exit 1; 7 suites passed, 11 failed on removed
  Pi package imports/manifests. Passing suites were sandbox, approval-storage,
  learn-materials, learn-workshop, learn-storage, learn-vault, and
  learn-end-to-end. Parent owns migration of the obsolete Pi-dependent wrappers.
- `node scripts/check-docs.mjs`: exit 1 on parent-owned release-manifest drift
  (`agent/neura/palette.ts` missing from the managed-file manifest). This slice
  does not edit that manifest or claim the combined migration passes legacy gates.

Parent owns CLI, Learn/Work, installer, legacy cleanup, broader verification, and
script migration. No commit, tag, push, live install, remote mutation, or private
profile inspection was performed.

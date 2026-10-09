# Shared capability and process contracts

These source contracts support #25's scoped extraction and consumption milestones. They are not
an autonomous task authority engine (#92), durable recovery state (#28), a new
approval ledger, or a claim that all of #25's original runtime overview is done.

## Capability descriptions

`agent/neura/capabilities.ts` describes tool effects, scope, reversibility,
network, secrets, timeout, and approval class. Bounds that cannot be established
are explicitly `unknown`; a null timeout means the caller/provider owns the
bound, not unlimited execution. `describeCapability` is descriptive, not a grant.
`secrets: possible` includes secrets supplied in arguments or workspace content;
cleared host environments are not a promise of secret-free workspace scripts.
`network: none` describes no outbound transport in the ordinary operation.
Ordinary task-scoped effects do not require blanket per-tool approval. Modes,
argument inspection, canonical containment, current task authority and exact
approval bindings must still authorize every effect. A protected/denied inspected
action describes an exception boundary; that description cannot lift its route.

Action inspection adds this description to `InspectedAction` in
`action-contracts.ts`. Existing imports from `action-policy.ts` remain supported.
Fingerprints and version-2 approval bindings are unchanged and do not derive
authority from metadata. The actual consumers are:

| Boundary | Descriptive value consumed | Existing authority retained |
| --- | --- | --- |
| Restricted mode selection | `restrictCapabilityToolNames` removes names whose descriptions meet `hasRemoteCapabilityBoundary`, after exact Plan/Learn/Work/Human Away selection. | Exact allowlists, available/user-selected tools, order and YOLO restoration. |
| Restricted provider schemas | The same remote ceiling follows canonical aliases and exact selected-name membership in top-level `tools`, `config.tools`, `toolConfig.tools` and nested `functionDeclarations`. | Metadata cannot expose an unselected tool; arguments still face deterministic policy. |
| Gmail guardrail | Exactly known read-only `effects` exempt confirmation in Work/Human Away; unknown apparent reads and mutations still confirm or block headless. | This exemption does not expose Gmail in restricted mode/provider selections; Plan/Learn deny it and YOLO bypasses application mediation. |
| MCP automatic initialization | Exact `mcp__` prefix plus the same remote-boundary description are prerequisites. | Ready YOLO lease, no eager connection or pending-restoration fallback; `/mcp` discovery requires the lease, not a pre-discovery descriptor. |
| Human Away reviewer clamp | `exception-boundary` approval class is additionally required for automatic bounded-delete approval. | Review route and every generated/untracked/file/workspace fact remain mandatory; human/deny routes and exact retries are unchanged. |

The remote projection recognizes remote-mutation effects, mailbox scope, and
external scope without task-scoped approval class. Task-scoped `web_search` is
exempt from this particular ceiling, not from its own argument policy. Unknown
metadata is not a blanket denial: Bash and Learn retain their exact selections.
False means only “this projection found no remote boundary,” never “safe” or
“allowed.” Explicit arbitrary supplied names are still subject to exact caller
selection. A descriptor mismatch narrowly fails closed: inconsistent MCP
metadata suppresses automatic initialization; an inconsistent inspected approval
class defers automatic reviewer approval. No new approval authority is granted.

Work/Human Away tool schemas and execution share declared sandbox timeout bounds.
Plain Pi's `NEURA` gate is unchanged. Learn lesson creation,
material import and exercise evaluation declare `execute` for their SQL/parser
workers; progress remains read/write. This description does not change permission.

Syntax-only Plan shell parsing lives in `plan-shell-parser.ts`; filesystem and
junction-aware containment remain in action policy. Extracted policy files remain
protected control paths. Plan remains read-only except controlled publication.

## Process mechanics

`executeProcess(file, args, options)` in `process.ts` uses `execFile`, never an
implicit shell. Explicit options include cwd, timeout, cancellation signal,
output bound and environment. It returns raw stdout/stderr, exit/error code,
termination reason, cancellation/timeout flags, completion and monotonic elapsed
milliseconds. Numeric nonzero exits are completed failures. Spawn failure,
timeout, cancellation and buffer exhaustion are not completed verdicts. Invalid
Node API arguments still reject the promise; callers must not interpret them as
completed execution. Zero timeout disables the deadline, as in Node's `execFile`.

Deadline initiation is recorded independently of the final callback error/signal.
A cooperative POSIX SIGTERM handler may exit 0 or nonzero with no final signal;
after deadline expiry it still yields `timedOut: true`, `ok: false` and
`completed: false`. `timedOut` records actual deadline initiation, while
`cancelled` records Node's native `ABORT_ERR` callback classification. A later
abort cannot erase the deadline fact: both flags can be true and primary
`termination` remains `cancelled`. An abort/buffer failure that already initiated
termination before the deadline does not invent expiry. These facts do not
attest physical child exit. Both adapters intentionally inherit the narrow
deadline-failure correction of the former success/completed misclassification;
their shapes, stream handling, defaults and ordinary nonzero-completed semantics
remain unchanged.

Compatibility adapters intentionally differ:

| Caller | Output | Defaults / completion |
| --- | --- | --- |
| `core.runProcess` | trimmed stdout and stderr | 3 seconds, 4 MiB, legacy `{ok, stdout, stderr}`; optional signal and buffer bound |
| `verification.execute` | raw stdout (including NUL and whitespace) | caller timeout, 1 MiB, legacy `{ok, stdout, completed}` |
| Human Away WSL runner | caller-selected redaction / bounded slicing | retains its separate WSL bootstrap, environment and error mapping |

Executable resolution, hash/version trust, environment selection, authorization,
redaction and leases remain caller-owned. The new service does not sanitize or
replace a caller's environment, select an executable, kill process trees, or
claim an OS isolation guarantee. Timeout initiates SIGTERM and closes captured
streams, matching execFile's cleanup; it is not a hard completion deadline for a
child that ignores termination. Timeout/cancellation duration ends at the Node
callback, not an attested process-tree or descendant-drain time.

## Seams for #92 and #28

- #92 can consume `CapabilityMetadata`, `ToolEvent`, `ActionFacts` and the existing
  deterministic `InspectedAction`/approval binding. Unknown metadata must not
  expand authority. Task/risk schemas and authority evaluation are not provided
  here; they must remain separate from descriptive capability lookup.
- #28 can consume `ProcessOptions`/`ProcessOutcome` for bounded execution and the
  idempotent `HostOperationLease` lifecycle fence. `acquireHostOperation` still
  blocks mode crossing and waits for leases to drain during restoration. It is
  not a durable ownership token, writer fence, checkpoint format or evidence that
  a remote effect is known. Durable execution IDs/unknown-result reconciliation
  remain #28 work.
- Existing session mode entries, hook ordering, cancellation ownership, proof
  completion checks and exact approvals remain unchanged. This milestone adds no
  session storage or competing authority/approval engine.

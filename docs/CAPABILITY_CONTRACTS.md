# Shared capability and process contracts

These source contracts support the first #25 extraction milestone. They are not
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
authority from metadata. Gmail uses the same exact known-read classification;
unknown Gmail operations still require confirmation outside YOLO. MCP shares the
name classifier and retains its YOLO-only lease. Mode tool selection shares read
and sandbox names, but its exact allowlists and provider filtering remain in
`mode-tools.ts`. Work/Human Away tool schemas and execution share declared sandbox
timeout bounds. Plain Pi's `NEURA` gate is unchanged.

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
completed execution.

Compatibility adapters intentionally differ:

| Caller | Output | Defaults / completion |
| --- | --- | --- |
| `core.runProcess` | trimmed stdout and stderr | 3 seconds, 4 MiB, legacy `{ok, stdout, stderr}`; optional signal and buffer bound |
| `verification.execute` | raw stdout (including NUL and whitespace) | caller timeout, 1 MiB, legacy `{ok, stdout, completed}` |
| Human Away WSL runner | caller-selected redaction / bounded slicing | retains its separate WSL bootstrap, environment and error mapping |

Executable resolution, hash/version trust, environment selection, authorization,
redaction and leases remain caller-owned. The new service does not sanitize or
replace a caller's environment, select an executable, kill process trees, or
claim an OS isolation guarantee. Cancellation duration ends at the Node callback,
not an attested descendant-drain time.

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

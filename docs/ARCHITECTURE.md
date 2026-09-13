# Architecture

## System boundary

Neura is a configuration and extension layer around Pi. Repository checkout is
source of truth. Pi executes copies installed under `~/.pi/agent/`.

```text
launcher/neura.cmd
  sets NEURA=1
  starts Pi
    optional Windows Terminal profile renders local launch artwork
    loads agent/settings.json and agent/mcp.json
    loads agent/extensions/*.ts
      uses agent/neura/*.ts shared modules
      updates terminal UI and local state
      may call optional local or remote dependencies
```

Plain `pi` stays stock for Neura-specific extensions because they return early
unless `NEURA` is set. October additionally requires YOLO and its configured bus
environment. It is not an exception to the plain-Pi boundary.

## Turn lifecycle

```text
session_start
  start in Work, restore permitted mode, apply theme, show centred launch overlay, activate tools
  pause tools while operations from a replaced session drain

interactive, print, JSON, or RPC input
  start or resume an explicit Plan request lifecycle
  surface Human Away queue when needed

agent_start
  hide logo; capture a checkpoint in YOLO only
  record proof worktree state in Work/YOLO

tool_call
  selected mode's deterministic tool and action policy
  Gmail-specific confirmation
  execute only when hooks allow

agent_end
  queue at most one missing-publication Plan retry
  cockpit completion

agent_settled
  emit final machine-readable Plan contract failure when still unpublished
  quick proof starts here for changed Work/YOLO worktrees
```

## Extension map

| Extension | Responsibility | External dependency or state |
|---|---|---|
| `neura.ts` | Centred launch overlay/fallback, identity, theme, `/dash`, `/notices`, persona injection | `NEURA.md`, cockpit state |
| `modes.ts` | Mode switching, active-tool boundary, approval UI | Session entries, approval store |
| `mcp.ts` | Explicit YOLO-only MCP discovery and reconnect gating | Filtered `@spences10/pi-mcp` package, `mcp.json` |
| `guardrail.ts` | Plan, Work, Human Away, and Learn policy; explicit YOLO bypass | Action policy, Headmaster, Learn policy |
| `gmail-guardrail.ts` | Gmail mutation confirmation | Gmail MCP tool names |
| `human-away-sandbox.ts` | Registers `work_exec` and Human Away's sole execution tool | WSL2, bubblewrap |
| `learn.ts` | Lessons, document imports, exercises, progress, `/learn` | Controlled `.neura-learning/` store; locked parser runtime |
| `plan-artifact.ts` | Plan request lifecycle and controlled HTML publication | Session entries, `plans/`, renderer/policy |
| `checkpoint.ts` | YOLO-only pre-turn snapshots and `/undo` | Git object database, temp index |
| `check-gate.ts` | Work/YOLO quick proof and full `/ship`; no Git publishing | Work sandbox or YOLO host proof, content-bound receipts |
| `cockpit.ts` | Footer and active-operation UI | Shared cockpit state |
| `harness-health.ts` | YOLO-only required/optional capability health and bounded integration probes | Exact Pi runtime contract, Git, uvx, MCP initialization, local Qwen |
| `transcript-actions.ts` | Answer/code copy | Pi clipboard API |
| `neura-memory.ts` | YOLO-only local cross-session facts | `~/.pi/agent/neura/MEMORY.md` |
| `presets.ts` | GPT, Opus, local Qwen switching | Provider login or llama.cpp |
| `skill-doctor.ts` | YOLO-only skill compatibility scan | Local skill directories |
| `ship-report.ts` | End-of-iteration response contract | None |
| `october-bus.ts` | Optional YOLO-only local multi-agent context bus | Local October HTTP service and environment variables |

## Shared module map

| Module | Responsibility |
|---|---|
| `action-policy.ts` | Canonical paths, action facts, classification, risk, route, fingerprints |
| `approval-store.ts` | Hash-chained JSONL, one-use grants, cross-process writer lock, fail-closed corruption/crash handling |
| `headmaster.ts` | Isolated no-tool reviewer subprocess and verdict parsing |
| `mode-state.ts` | Five modes, Work default, operation leases, deferred session restoration |
| `learn-policy.ts` | Learn tool allowlist and bounded private-path denial |
| `learn-schema.ts`, `learn-renderer.ts` | Structured lessons and escaped standalone HTML/SVG boards |
| `learn-exercises.ts` | Practice grading and bounded disposable SQLite evaluation |
| `learn-materials.ts`, `learn-materials-worker.mjs` | Captured document bytes, parser worker, citations, offline OCR |
| `learn-store.ts` | Owned local store, exclusive writes, explicit snapshots and resume |
| `plan-policy.ts` | Plan tool list, URL policy, plan directory rules |
| `plan-renderer.ts` | Escaped static HTML generation |
| `cockpit-state.ts` | Shared UI state and subscribers |
| `human-away-sandbox.ts` | Workspace link checks, minimal WSL host bridge, bubblewrap namespace/mount contract |
| `redaction.ts` | Central secret-shaped text and structured-value redaction |
| `core.ts` | Process, Git, ANSI, palette, and layout helpers |
| `ui-tokens.ts` | Shared terminal tokens, glyphs, motion values, width fitting |
| `runtime-contract.json` | Versioned Neura/Pi runtime contract shared by health and installation |

## Persistent state

| State | Location | Repository tracked |
|---|---|---|
| Source harness | Repository checkout | Yes |
| Live harness | `~/.pi/agent/` | No |
| Launcher | `~/.local/bin/neura.cmd` | No; source tracked under `launcher/` |
| Launch artwork | `~/.pi/agent/neura/launch-artwork.png` | Source asset tracked under `agent/neura/` |
| Windows Terminal profile | `%LOCALAPPDATA%/Microsoft/Windows Terminal/Fragments/Neura/Neura.json` | No; generated by installer |
| Memory | `~/.pi/agent/neura/MEMORY.md` | No |
| Approval audit | `~/.pi/agent/neura/approvals/audit.jsonl` | No |
| Session mode | Pi session custom entry | No |
| Plan contract outcome | Pi `neura-plan-contract` custom entry | No |
| Checkpoints | Process memory plus Git objects | No |
| Plan artifacts | Project `plans/` directory | Usually yes |
| Learn boards and explicit snapshots | Workspace `.neura-learning/` | No; owned store includes Git exclusion |
| Pending Learn initialization | Sibling `.neura-learning-init-UUID` | No lesson content; metadata-only stages can remain after interruption |
| Proof receipts | Pi `neura-verification` session entries | No |
| Incremental suite report | `.proofofwork/neura-checks.json` | No; untrusted evidence bound to workspace fingerprint |

Learn does not auto-load snapshots or sync browser state. Saved source text is
historical and unverified until reimported; images are omitted. Store creation
requires native Windows. See [Learn Mode](LEARN_MODE.md).

## Trust model

- Deterministic policy is authoritative. Headmaster output cannot widen policy.
- YOLO bypasses Neura application policy by design; user intent and higher-priority
  instructions remain its scope boundary, but no Neura hook technically enforces it.
- Plan text is untrusted and rendered through structured escaped fields.
- Credentials stay outside source and must be redacted before model or audit use.
- Plan and Learn path checks are application controls, not OS isolation.
- Work execution/proof and Human Away execution use network-disabled WSL2
  bubblewrap; unavailable isolation fails closed. Work's generic reads/searches
  do not become an OS-isolated confidentiality boundary.
- Learn parsers use bounded child processes and trusted native/WASM dependencies;
  document content never grants tool permissions. Citation validation establishes
  source identity and excerpt location, not semantic correctness.
- Host checkpoints, health, memory, skill scans, and October are YOLO-only.
  Operation leases prevent their work crossing into a restricted mode.
- Repository and live harness are separate states; drift checks matter.

## Verification architecture

`scripts/test-suites.mjs` defines 17 suites, each launched with a temporary home,
synthetic state, and the checkout's pinned Pi loader. Windows covers the full
harness and real Plan/Learn browsers; Linux covers portable boundary contracts.
See [VERIFICATION.md](VERIFICATION.md) for suite commands, proof fingerprints,
receipt limits, and approval-lock recovery restrictions.

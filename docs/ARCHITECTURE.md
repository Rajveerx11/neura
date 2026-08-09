# Architecture

## System boundary

Neura is a configuration and extension layer around Pi. Repository files are the
source of truth. Pi executes copies installed under `~/.pi/agent/`.

```text
launcher/neura.cmd
  sets NEURA=1
  starts Pi
    loads agent/settings.json and agent/mcp.json
    loads agent/extensions/*.ts
      uses agent/neura/*.ts shared modules
      updates terminal UI and local state
      may call optional local or remote dependencies
```

Plain `pi` stays stock for Neura-specific extensions because they return early
unless `NEURA` is set. `october-bus.ts` is the exception: it activates only when
all October bus environment variables are present.

## Turn lifecycle

```text
session_start
  restore mode, apply theme, show logo, activate tools

interactive, print, JSON, or RPC input
  start or resume an explicit Plan request lifecycle
  surface Human Away queue when needed

agent_start
  hide logo, capture checkpoint, record initial worktree state

tool_call
  Plan boundary or action policy
  Gmail-specific confirmation
  execute only when hooks allow

agent_end
  queue at most one missing-publication Plan retry
  cockpit completion

agent_settled
  emit final machine-readable Plan contract failure when still unpublished
  proof-of-work quick check currently starts here
```

## Extension map

| Extension | Responsibility | External dependency or state |
|---|---|---|
| `neura.ts` | Identity, theme, `/dash`, `/notices`, persona injection | `NEURA.md`, cockpit state |
| `modes.ts` | Mode switching, active-tool boundary, approval UI | Session entries, approval store |
| `guardrail.ts` | Plan and Human Away tool-call policy; explicit YOLO bypass | Action policy, Headmaster |
| `gmail-guardrail.ts` | Gmail mutation confirmation | Gmail MCP tool names |
| `human-away-sandbox.ts` | Registers the only Human Away execution tool | WSL2, bubblewrap |
| `plan-artifact.ts` | Plan request lifecycle and controlled HTML publication | Session entries, `plans/`, renderer/policy |
| `checkpoint.ts` | Pre-turn Git tree snapshots and `/undo` | Git object database, temp index |
| `check-gate.ts` | Quick proof feedback and `/ship` | `uvx`, proof-of-work |
| `cockpit.ts` | Footer and active-operation UI | Shared cockpit state |
| `harness-health.ts` | Runtime readiness panel | Pi, Git, uvx, MCP config, local Qwen |
| `transcript-actions.ts` | Answer/code copy | Pi clipboard API |
| `neura-memory.ts` | Local cross-session facts | `~/.pi/agent/neura/MEMORY.md` |
| `presets.ts` | GPT, Opus, local Qwen switching | Provider login or llama.cpp |
| `skill-doctor.ts` | Skill compatibility scan | Local skill directories |
| `ship-report.ts` | End-of-iteration response contract | None |
| `october-bus.ts` | Optional local multi-agent context bus | Local October HTTP service and environment variables |

## Shared module map

| Module | Responsibility |
|---|---|
| `action-policy.ts` | Canonical paths, action facts, classification, risk, route, fingerprints |
| `approval-store.ts` | Hash-chained JSONL decisions and one-use retry grants |
| `headmaster.ts` | Isolated no-tool reviewer subprocess and verdict parsing |
| `mode-state.ts` | Current mode and labels |
| `plan-policy.ts` | Plan tool list, URL policy, plan directory rules |
| `plan-renderer.ts` | Escaped static HTML generation |
| `cockpit-state.ts` | Shared UI state and subscribers |
| `human-away-sandbox.ts` | Workspace link checks, minimal WSL host bridge, bubblewrap namespace/mount contract |
| `redaction.ts` | Central secret-shaped text and structured-value redaction |
| `core.ts` | Process, Git, ANSI, palette, and layout helpers |
| `ui-tokens.ts` | Shared terminal tokens, glyphs, motion values, width fitting |

## Persistent state

| State | Location | Repository tracked |
|---|---|---|
| Source harness | `C:\Neura` | Yes |
| Live harness | `~/.pi/agent/` | No |
| Launcher | `~/.local/bin/neura.cmd` | No; source tracked under `launcher/` |
| Memory | `~/.pi/agent/neura/MEMORY.md` | No |
| Approval audit | `~/.pi/agent/neura/approvals/audit.jsonl` | No |
| Session mode | Pi session custom entry | No |
| Plan contract outcome | Pi `neura-plan-contract` custom entry | No |
| Checkpoints | Process memory plus Git objects | No |
| Plan artifacts | Project `plans/` directory | Usually yes |

## Trust model

- Deterministic policy is authoritative. Headmaster output cannot widen policy.
- YOLO bypasses Neura application policy by design; user intent and higher-priority
  instructions remain its scope boundary, but no Neura hook technically enforces it.
- Plan text is untrusted and rendered through structured escaped fields.
- Credentials stay outside source and must be redacted before model or audit use.
- Plan guardrails reduce mistakes but do not replace an OS sandbox. Human Away
  adds a WSL2 bubblewrap boundary and exposes no normal or MCP tools; YOLO remains
  intentionally unsandboxed.
- Repository and live harness are separate states; drift checks matter.

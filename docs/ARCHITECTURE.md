# Architecture

Updated 2026-11-07. The active application is `src/cli.ts`, backed by Mastra.
It exposes Work and Learn. Retained Pi extensions are migration evidence and
are outside the active import graph. See [status](STATUS.md) for release limits.

## Runtime boundary

`launcher/neura.cmd` invokes the chosen checkout's `src/cli.ts`. The CLI owns
provider selection, conversation history, session locks, mode changes and terminal
input. `src/runtime.ts` wraps a real Mastra Agent with serialized tool effects,
schema validation and cancellation. Turns are bounded: 60 steps for Work builders,
eight for Learn and reviewers.

| Source | Responsibility |
| --- | --- |
| `src/cli.ts` | Startup, commands, current generation, approval input and turn orchestration |
| `src/brand.ts`, `src/terminal-ui.ts` | Approved logo, width-aware status/help, plain-text and color fallbacks |
| `src/providers.ts`, `src/auth.ts` | Separate subscription, loopback local, OpenAI API and Anthropic API transports. Explicit subscription login/logout |
| `src/work.ts` | Workspace tools, byte-bound mutations, project guidance and sandbox command admission |
| `src/review.ts`, `src/workflow.ts` | Candidate risk, read-only reviewer, receipt currency and bounded builder fixes |
| `src/verification.ts` | Manual Work proof request, trusted offline sandbox invocation and detector receipts |
| `src/learn.ts`, `src/learn-state.ts` | Dedicated Learn tools, lessons, attempt provenance, async state fences and explicit progress recovery |
| `src/session.ts`, `src/session-lock.ts` | Workspace-keyed conversations and exclusive writer leases |

## Shared Neura services

Active source reuses Neura-owned modules under `agent/neura/`. Their directory
name does not imply a Pi dependency. Canonical containment, redaction, scoped
process environments, Git snapshots and the WSL2/bubblewrap bridge are shared.
Learn reuses the material worker, schemas, renderer, exercise evaluator, marked
store and opt-in vault writer. Exact reachable imports are checked by
`scripts/check-pi-free.mjs`, alongside locked package closure and license rules.

The graph check is a package/import identity check, not exhaustive certification
of embedded code or third-party licenses. The [dependency review](MASTRA_V1_DEPENDENCIES.md)
records the unresolved distribution boundary.

## Work turn and review

1. Capture the workspace baseline when available. Load root `AGENTS.md` and
   `CLAUDE.md` as bounded, untrusted user context without persisting them in history.
2. Run builder tools through current mode/generation checks and deterministic
   policy. Original bytes bind edits. Secret-shaped content is redacted on delivery.
3. Commands execute only inside offline WSL isolation. Policy-allowed commands
   can run without a prompt. Other permitted actions need exact interactive approval.
   Gitfiles, runtime-overlapping workspaces and unsupported isolation are refused.
4. After changes, path-based risk routing skips docs-only changes. Substantive
   changes get a fresh reviewer with code-enforced read-only tools. The controller
   marks must-fix findings and permits up to three builder-fix rounds.
5. Bind receipts to the candidate fingerprint. Later edits make them stale.
   Step exhaustion preserves the task's initial baseline for continuation.

Review ends `READY FOR YOUR APPROVAL`, `BLOCKED` or `Review skipped`. Turns that
change nothing stay quiet. No baseline means automatic review is unavailable.
The default reviewer uses the builder model and is labelled same-family. An
explicit different provider enables cross-family review. No workflow path
commits, pushes or merges. See [verification](VERIFICATION.md).

## Learn turn and recovery

The model receives four dedicated tools: `learn_material`, `learn_lesson`,
`learn_exercise`, `learn_progress`, plus bounded public-workspace `read`/`ls`.
It receives no generic mutation, shell, integration or web-search tool. Lesson
publication and evaluated attempts terminate the turn. Exercise answers must
match actual learner input. Model-invented attempts are rejected.

Async operations recheck session/mode epochs before publishing state or warnings.
Completed disk/vault writes can remain after cancellation or a stale-operation
refusal. This is not a transaction across stores. `/learn save` is explicit.
Conversation resume does not silently restore a lesson. Saved excerpts remain
historical until reimport, and browser actions return through copied commands.

## Stored state

| State | Current location and ownership |
| --- | --- |
| Source and dependencies | Checkout, root lockfile and separate `agent/neura` lockfile |
| Optional launcher | User-local `neura.cmd`, tracked by a development-install receipt |
| Credentials | `codex-auth.json` under `~/.neura` or explicit `NEURA_HOME`. Inspect Windows DACLs before use |
| Conversations and crash locks | Neura home's `sessions/<workspace-hash>/`. No Pi import |
| Learn boards, material assets and explicit snapshots | Owned workspace `.neura-learning/` store with Git exclusion |
| Optional vault configuration | `NEURA_LEARN_VAULT` or Neura home's `learn-vault.json` |
| Optional learning events/projections | Configured Obsidian vault's owned `Neura/` subtree |
| Review and proof receipts | Current process/session memory. No durable attestation |

Private home and workspace must be disjoint in both directions. Pi profiles
cannot be workspace roots. Development installation and retirement preserve
legacy credentials, memory, approvals, sessions and vaults, along with unmatched user files.

## Trust and limits

Deterministic policy outranks model output and project guidance. Work command
isolation protects host paths, secret-named files and Git/configuration directories. Ignored files without secret names may remain readable. Host execution of generated
project code still requires user review. Learn path checks and parser resource
bounds are application controls, not OS isolation against a hostile same-user process.

There is no Plan, YOLO, Human Away, MCP/LSP, delegation, context compaction,
durable effect recovery or full trusted proof in the active application. The
[parity matrix](PARITY_MATRIX.md) tracks those gaps without treating retained
extensions or old tests as active behavior.

# Neura status

Last audited: 2026-08-09
Target: `2.5.1` stable
Current: `2.5.1` stable source; tag/release waits for green CI on the release commit

## Release decision

**Ready for a stable tag after release-commit CI passes.** Named security,
dependency, typecheck, Windows CI, and live-sync gates are implemented; their
equivalent local checks pass. Normal supervised engineering is usable. Human Away remains
preview-labelled per project policy even with its new WSL2 boundary.

## Capability matrix

| Capability | State | Evidence or limit |
|---|---|---|
| Logo-only launch and persona | Ready | `neura.ts` renders only the responsive wordmark, then hides it when work starts. |
| Responsive cockpit and theme | Ready | Harness checks 24-120 column layouts and the ten-line widget cap. |
| Plan tool boundary | Ready | Plan activates a fixed tool set and blocks normal mutation tools. |
| Plan filesystem containment | Ready | Filesystem tools resolve aliases, real paths, symlinks, junctions, and missing descendants before workspace comparison. Git inspection is limited to objects, refs, and index-only views under exact options that disable config-driven process and mailmap paths; unstaged diff requires explicit range-plus-separator syntax and worktree-aware modes are denied. |
| Plan external research | Ready with limits | Bounded `web_search` remains available. Direct `web_fetch` is disabled because the delegated Ollama backend does not expose DNS answers, connection IPs, or redirect hops for policy enforcement. |
| Visual Plan publisher | Ready | Structured input, escaped output, restrictive CSP, collision-safe creation, explicit waiting/new/revision lifecycle, session-owned revisions, and external-edit detection. TUI, print, JSON, and RPC runs share a one-retry publication contract; exhausted and successful outcomes emit versioned session entries. |
| Checkpoints and `/undo` | Ready with limits | Snapshots are in memory, exclude ignored files, and do not delete files created after a snapshot. |
| Persistent memory | Ready for personal use | Local Markdown file under the live harness; no encryption or multi-user isolation. |
| Transcript copy and model presets | Ready | Covered by deterministic harness tests. External model login and local Qwen remain operator dependencies. |
| MCP configuration | Optional | gfi-scout, Context7, and Gmail are enabled when credentials exist. Paper, Supabase, and Notion ship disabled. |
| Proof-of-work gate | Preview | Quick proof starts at `agent_settled`; unavailable proof fails soft. Full `/ship` verification remains explicit. |
| Automatic Git shipping | Removed | No lifecycle hook stages, commits, or pushes. The installer removes the retired `autogit.ts`; Git changes occur only through requested tool calls. |
| Live harness sync | Ready | The generated install was audited, synced through `install.ps1`, and rechecked against source. Local settings, keybindings, and unrelated local-only files remain preserved; retired `autogit.ts` is absent. |
| YOLO policy | Ready with explicit risk | Matches Codex dangerous-full-access semantics: no Neura application approvals or tool blocking and no native-Windows OS sandbox. Harness tests cover sensitive shell, protected-file, and Gmail bypass. |
| Approval grants | Ready | One-use grants bind canonical target identity, target content/state, exact input, workspace state, `HEAD`, index state, and 120-second expiry. Legacy pending records cannot grant retries. |
| Central redaction | Ready with limits | One implementation covers action summaries, approval text, cockpit notices, reviewer dossiers, Gmail summaries, and sandbox output. Pattern matching remains defense in depth, not permission to handle raw secrets. |
| Human Away | Preview | Only `human_away_exec` reaches the provider. WSL2 bubblewrap exposes one writable workspace mount, read-only system runtime, cleared host environment, hidden Windows/WSL user paths, no network, and link preflight. Missing prerequisites fail closed. |
| Gmail mutation policy | Ready | Outside YOLO, only exact read-only actions pass. Every other known or unknown Gmail action confirms interactively or blocks headless. YOLO intentionally bypasses mediation. |
| Release reproducibility | Ready | Pi `0.84.1`, all runtime packages, TypeScript, and type dependencies are exact-pinned. Lockfile install, typecheck, vulnerability/signature audit, harness/docs checks, and Windows install/drift checks run in CI. |

## Completed for `2.5.1` stable

1. Approval grants are target/content/Git/input/expiry bound with positive and
   replay-negative tests.
2. Central redaction covers URL queries, headers, provider tokens, JWTs,
   connection strings, high-entropy values, notices, audits, and reviewer input.
3. Gmail uses an explicit read-only allowlist and fails closed for unknown
   headless actions.
4. Pi and every `agent/settings.json` package are exact-pinned with reviewed
   sources, lifecycle behavior, update policy, registry signatures, and audit.
5. TypeScript, dependency audit, harness/docs verification, and install/drift
   validation run in pinned Windows CI.

## Human Away preview evidence

1. WSL2 bubblewrap is the only Human Away execution route; normal and MCP tools
   are filtered from active tools and provider payloads.
2. Deterministic and live replay covers linked-path swaps between calls, shell
   parsing, custom/MCP tool removal, secret-shaped values, approval reuse,
   target/`HEAD`/index changes, audit corruption, host environment, network,
   system writes, and Windows/WSL path visibility.
3. Human Away remains labelled `PREVIEW` for field validation and because Plan
   and YOLO retain their documented application-only/unsandboxed boundaries.

## Deferred until evidence supports them

- Per-tool color badges.
- Agent scorecards.
- More dashboards or launch content.
- Hosted Plan artifacts.

New features should solve repeated engineering friction. They should not delay
the security and release gates above.

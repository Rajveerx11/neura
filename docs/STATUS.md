# Neura status

Last audited: 2026-08-06
Target: `2.5.1` stable
Current: `2.5.1-rc.1` private release candidate

## Release decision

**Not ready for a stable tag.** Normal supervised engineering is usable. Plan
mode has canonical workspace containment. Human Away remains preview-only.

## Capability matrix

| Capability | State | Evidence or limit |
|---|---|---|
| Logo-only launch and persona | Ready | `neura.ts` renders only the responsive wordmark, then hides it when work starts. |
| Responsive cockpit and theme | Ready | Harness checks 24-120 column layouts and the ten-line widget cap. |
| Plan tool boundary | Ready | Plan activates a fixed tool set and blocks normal mutation tools. |
| Plan filesystem containment | Ready | `read`, `grep`, `find`, and `ls` resolve aliases, real paths, symlinks, junctions, and missing descendants before workspace comparison. |
| Plan external research | Ready with limits | Bounded `web_search` remains available. Direct `web_fetch` is disabled because the delegated Ollama backend does not expose DNS answers, connection IPs, or redirect hops for policy enforcement. |
| Visual Plan publisher | Ready | Structured input, escaped output, restrictive CSP, collision-safe creation, session-owned revisions, and external-edit detection. |
| Checkpoints and `/undo` | Ready with limits | Snapshots are in memory, exclude ignored files, and do not delete files created after a snapshot. |
| Persistent memory | Ready for personal use | Local Markdown file under the live harness; no encryption or multi-user isolation. |
| Transcript copy and model presets | Ready | Covered by deterministic harness tests. External model login and local Qwen remain operator dependencies. |
| MCP configuration | Optional | gfi-scout, Context7, and Gmail are enabled when credentials exist. Paper, Supabase, and Notion ship disabled. |
| Proof-of-work gate | Preview | Quick proof starts at `agent_settled`; unavailable proof fails soft. Full `/ship` verification remains explicit. |
| Automatic Git shipping | Removed | No lifecycle hook stages, commits, or pushes. The installer removes the retired `autogit.ts`; Git changes occur only through requested tool calls. |
| YOLO policy | Ready with explicit risk | Matches Codex dangerous-full-access semantics: no Neura application approvals or tool blocking and no native-Windows OS sandbox. Harness tests cover sensitive shell, protected-file, and Gmail bypass. |
| Human Away | Preview | Deterministic review and queue exist, but there is no OS sandbox and approval binding is incomplete. |
| Gmail mutation policy | Preview | Outside YOLO, named mutations confirm. Unknown Gmail actions currently pass instead of using a read-only allowlist. YOLO intentionally bypasses this mediation. |
| Release reproducibility | Incomplete | Pi is pinned in CI/install docs; most extension packages in `settings.json` remain unpinned. No typecheck job exists. |

## Required before `2.5.1` stable

1. Bind approval grants to canonical target identity, relevant content/state hash,
   `HEAD`, index state, action input, and expiry.
2. Centralize redaction across action summaries, approval records, notices, and
   reviewer dossiers. Cover URL queries, headers, provider tokens, JWTs,
   connection strings, and high-entropy values.
3. Replace Gmail's non-YOLO mutation-name confirmation list with an explicit read-only
   allowlist. Confirm or block every other Gmail tool.
4. Pin Pi and every package used by `agent/settings.json`; record update policy.
5. Add TypeScript typechecking, dependency audit, and complete Windows CI.
6. Sync the repository into the live harness and make `install.ps1 -Check` pass.

## Required before expanding Human Away

1. Run tools inside a WSL2 or container boundary with workspace-only mounts.
2. Add adversarial replay for path races, symlink swaps, shell parsing, custom
   tools, MCP mutations, secret-shaped values, approval reuse, and audit failure.
3. Keep Human Away labelled `PREVIEW` until both items pass.

## Deferred until evidence supports them

- Per-tool color badges.
- Agent scorecards.
- More dashboards or launch content.
- Hosted Plan artifacts.

New features should solve repeated engineering friction. They should not delay
the security and release gates above.

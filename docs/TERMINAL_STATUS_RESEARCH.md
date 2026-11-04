# Terminal identity and status research

Reviewed 2026-11-02 for the isolated Mastra v1 UI development branch. This is a source review, not a hands-on evaluation of the upstream applications or a production-readiness claim.

## Evidence and decisions

| Source | Observed implementation | Neura decision |
| --- | --- | --- |
| [Pi footer](https://github.com/earendil-works/pi/blob/642e30b68930a644050794011555a04ed9027eb4/packages/coding-agent/src/modes/interactive/components/footer.ts) | Workspace/branch line, cumulative token statistics, separate context occupancy, model and thinking state. Context may be unknown after compaction; width-aware truncation uses terminal cell measurement. | Keep orientation close to input. Distinguish conversation size, reported usage and context capacity. Never infer a context percentage from total tokens. |
| [OpenCode prompt footer](https://github.com/anomalyco/opencode/blob/805a42ffaa56b29a88baef87c7567f1ab9a40a8f/packages/tui/src/feature-plugins/prompt/footer.tsx) | Optional usage/cost from session data, live subagent/shell indicators only when present, width-dependent prioritization of usage and shortcuts. | Show only implemented state backed by data. Prefer a small status strip and explicit details over a dashboard. Do not add fake cost, agent or shell counts. |
| [OpenCode session sidebar](https://github.com/anomalyco/opencode/blob/805a42ffaa56b29a88baef87c7567f1ab9a40a8f/packages/tui/src/routes/session/sidebar.tsx) | Separate fixed-width session sidebar, scrollable content slots and footer. | Do not transplant this layout into Neura's readline interface. Preserve normal terminal scrolling and selection. |

The Pi repository URL supplied as `badlogic/pi-mono` redirected to `earendil-works/pi` during this review. Sources were retrieved through read-only GitHub CLI requests. Branch heads are recorded in the links above; no upstream code or dependencies were imported.

## Identity

Replace the five-line block alphabet with `o--o  neura`: two connected nodes for Work and Learn, with a literal connection rather than an ornamental AI-brain illustration. Keep the existing copper/bone/tungsten palette. The small mark leaves space for work and remains readable in a plain terminal.

## Status contract

- A prompt-adjacent strip, refreshed before input; not a screen-pinned TUI footer.
- Actual mode, selected provider/model, workspace label, history/session state and thinking-summary setting.
- Conversation message count is a message count, not a token estimate.
- Provider-reported last-turn input/output totals are usage, not the exact current context occupancy. A tool-using turn may contain several model requests.
- Missing usage and unknown context-window capacity stay unknown. No guessed context limits, billing rates, costs, compaction progress or percentages.
- `/status` is the detailed view: complete sanitized identifiers and workspace path, plus honest development limits.
- Automatic status belongs to interactive input only. Machine-oriented or explicit one-shot output must not gain the strip.
- State resets must not attach old usage to a new conversation, resumed history or newly selected model.

## Tradeoffs and limits

A readline status strip is smaller and safer to integrate than a full-screen terminal framework, but does not stay pinned while output scrolls. No animation, terminal-region takeover, or new dependency is needed. Resize is reflected when the next prompt is rendered, not necessarily while an existing prompt is being edited.

Pi's context percentage depends on session accounting and model-window metadata that this Neura checkout does not expose. Adding an attractive percentage without those inputs would mislead users. Full Unicode terminal-cell measurement remains a separate limitation of the earlier renderer, not something an ASCII-width test proves.

Verification and current implementation evidence are recorded in [TERMINAL_UX.md](TERMINAL_UX.md). Screenshots for the follow-up must come from the actual CLI through a real PTY; earlier synthetic presentation-helper previews are not live-application evidence.

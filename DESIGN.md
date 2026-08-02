# Neura Design System

## Direction

**Forged Tungsten** is Neura's visual system.

Neura is a personal engineering cockpit, not a general dashboard. It stays quiet
until state changes, risk appears, or evidence matters. The interface should feel
machined, direct, and personal: neutral dark surfaces, one burnt-copper accent,
bone text, and semantic colors used only for real outcomes.

## Product principles

1. **Continuity before overview.** Launch restores the last meaningful thread and
   presents one next action. It does not summarize everything.
2. **One active signal.** Copper identifies Neura, current focus, and the primary
   action. It is not decoration.
3. **Detail on demand.** Health, memory, agents, model control, proof detail, and
   recovery stay hidden until invoked.
4. **Evidence over activity.** Show milestones, verdicts, and recovery. Do not turn
   raw tool calls into permanent chrome.
5. **Meaning survives compression.** Phase, active task, safety, and verdict remain
   visible at narrow terminal widths. Ornament and metadata collapse first.
6. **Stock pi stays stock.** Theme and UI remain session-only behind `NEURA`.

## Color tokens

| Token | Value | Role |
|---|---:|---|
| Canvas | `#0b0c0e` | Terminal background and negative space |
| Surface | `#14171a` | Composer, widgets, panels |
| Raised | `#1c2024` | Selected or focused surface |
| Border | `#2c3237` | Rules and inactive controls |
| Copper | `#d97841` | Identity, focus, primary action |
| Bone | `#e8e2d8` | Primary text |
| Muted steel | `#a8a39b` | Supporting metadata |
| Dim | `#7a828b` | Inactive and historical text; 5.03:1 on canvas |
| Plan cyan | `#76b8c4` | Read-only boundary and code structure |
| Information blue | `#86a7d7` | Links and informational state |
| Success | `#69c08a` | Verified outcomes only |
| Warning | `#d3a64a` | Approval and degraded operation |
| Error | `#df6b63` | Blocked and failed outcomes |

Color rules:

- Decorative gradients, colored glows, and tinted ambient panels are not used.
- Copper is the only brand accent.
- Plan uses cyan. Human Away Preview and approvals use amber. Neither borrows success green.
- Success, warning, and error never replace copper for identity or navigation.
- Text must remain readable without relying on hue alone.

## Elevation and shape

- Three elevation levels only: canvas, surface, raised.
- One-cell borders create separation.
- Full-width editor borders stay neutral; copper is reserved for local focus and
  action signals, never used as an ambient rail.
- Radius is restrained and consistent where the terminal API supports it.
- Shadows are not part of terminal chrome.
- Pills are reserved for compact model, phase, or verdict labels.

## Typography and language

- Terminal monospace is the product typeface.
- Uppercase is reserved for phase, verdict, and short state labels.
- Actions use sentence case and name their result.
- Copy is terse, factual, and personal.
- No emoji or Devanagari.
- No em dash or en dash in interface copy.

## Launch system: ASCII identity and resume ledger

The original six-line NEURA block wordmark owns launch at 56 columns and above.
A compact five-line ASCII fallback appears below 56 columns. It appears once per
session, then clears when work starts.

The ledger answers four questions in order:

1. **READY:** Which workspace, branch, and dirty state are active?
2. **BOUNDARY:** Which mode and safety contract govern the session?
3. **LAST:** What meaningful thread did Rajveer leave?
4. **NEXT:** What is the single recommended continuation and are notices waiting?

While the launch ledger is visible, it alone owns workspace, branch, mode, and
safety context. The footer contracts to model and context usage, and the idle
cockpit rail renders nothing. After launch clears, the footer resumes mode and
session metadata ownership. Persistent zero-value service rows are hidden.

Wide layout uses a one-cell copper spine connecting the three rows. Narrow
layout stacks the same rows without losing labels. `NEXT` receives the only
strong emphasis.

Default actions:

- `Enter` resumes the recommended thread.
- `N` starts a fresh task.
- The composer remains the universal fallback.

Empty history becomes: `Fresh session. What are we building?`

## Lifecycle hierarchy

1. Phase
2. Active objective
3. Evidence or required decision
4. Ambient session metadata

Launch is continuity. Brief makes scope visible. Work shows one active step.
Approval owns focus. Proof separates running checks from verdict. Handoff closes
with changed scope, evidence, and one manual next action.

## Modes, motion, and decisions

- Shift+Tab cycles Plan, YOLO, and Human Away Preview.
- Mode changes enforce policy first, then show a capability latch for workspace,
  reviewer, sensitive action, and remote action boundaries.
- Motion settles within 360 ms. Latest transition wins. Reduced motion shows only
  the final frame.
- Human Away is always amber and always says `PREVIEW` until OS sandboxing exists.
- Approval is an agent action request: Neura, task, intent, exact action, evidence,
  boundary, fallback, and one-use grant scope. Denial has default focus.

## Responsive contract

- Validate at 40, 56, 72, 92, and 120 columns.
- Every widget remains within pi's ten-line cap.
- Model, phase, active task, safety, and verdict survive longest.
- Cost, context detail, branch detail, and secondary operation text collapse
  before primary meaning.
- No `(widget truncated)`, wrapped footer labels, or hidden primary action.

## Direction contract

<!--
THESIS: Neura launches by restoring continuity, not by presenting a dashboard.
OWN-WORLD: Tungsten neutrals, burnt copper, bone text, flat one-cell rules.
STORY: Rajveer sees where he left off, current boundary, and one next action.
FIRST VIEWPORT: Identity and readiness above a LAST/NOW/NEXT continuity spine.
FORM: Operate-mode terminal instrument; focused, responsive, and state-driven.
-->

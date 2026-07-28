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
| Dim | `#666a6d` | Inactive and historical text |
| Success | `#69c08a` | Verified outcomes only |
| Warning | `#d3a64a` | Approval and degraded operation |
| Error | `#df6b63` | Blocked and failed outcomes |

Color rules:

- Decorative gradients, colored glows, and tinted ambient panels are not used.
- Copper is the only brand accent.
- Success, warning, and error never replace copper for identity or navigation.
- Text must remain readable without relying on hue alone.

## Elevation and shape

- Three elevation levels only: canvas, surface, raised.
- One-cell borders create separation.
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

## Launch system: Continuity Spine

Launch answers three questions in order:

1. **LAST:** What meaningful thread did Rajveer leave?
2. **NOW:** Which workspace and operating boundary are active?
3. **NEXT:** What is the single recommended continuation?

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

## Responsive contract

- Validate at 48, 72, 92, and 120 columns.
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

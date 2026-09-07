# Neura Design System

## Direction

**Forged Tungsten** is Neura's visual system.

Neura is a personal engineering cockpit, not a general dashboard. It stays quiet
until state changes, risk appears, or evidence matters. The interface should feel
machined, direct, and personal: neutral dark surfaces, one burnt-copper accent,
bone text, and semantic colors used only for real outcomes.

## Product principles

1. **Identity before activity.** Launch shows only the Neura wordmark. Working
   state appears after first task begins.
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
| Information / Learn blue | `#86a7d7` | Links, informational state, and Learn mode |
| Success | `#69c08a` | Verified outcomes only |
| Warning | `#d3a64a` | Approval and degraded operation |
| Error | `#df6b63` | Blocked and failed outcomes |

Color rules:

- Decorative gradients, colored glows, and tinted ambient panels are not used.
- Copper is the primary product accent and owns the launch wordmark.
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

## Launch system: ASCII identity

`neura` opens with only the copper NEURA wordmark. The original six-line block
mark appears at 56 columns and above; a five-line ASCII fallback handles narrow
terminals. There is no illustration, status ledger, or launch animation. The
wordmark clears when work begins, and `/dash` toggles it on demand.

## Lifecycle hierarchy

1. Phase
2. Active objective
3. Evidence or required decision
4. Ambient session metadata

Launch is identity. Brief makes scope visible. Work shows one active step.
Approval owns focus. Proof separates running checks from verdict. Handoff closes
with changed scope, evidence, and one manual next action.

## Modes, motion, and decisions

- Shift+Tab cycles Plan, Work, YOLO, Human Away Preview, and Learn. Work is default.
- Mode changes enforce policy first, then show a capability latch for workspace,
  reviewer, sensitive action, and remote action boundaries.
- Motion settles within 360 ms. Latest transition wins. Reduced motion shows only
  the final frame.
- Human Away is always amber and always says `PREVIEW` until its transactional,
  resource, and field-validation gates pass; WSL2 isolation already exists.
- Approval is an agent action request: Neura, task, intent, exact action, evidence,
  boundary, fallback, and one-use grant scope. Denial has default focus.

## Responsive contract

- Validate at 40, 56, 72, 92, and 120 columns.
- Every widget remains within pi's ten-line cap.
- Model, phase, active task, safety, and verdict survive longest.
- Cost, context detail, branch detail, and secondary operation text collapse
  before primary meaning.
- No `(widget truncated)`, wrapped footer labels, or hidden primary action.

## Learn boards

- Teach one concept with 3-5 bullets, a practical example, and one next action.
- Use small flow, ER, or sequence diagrams with text alternatives. Keep diagrams
  scrollable on narrow screens and controls usable by keyboard.
- Separate source excerpts and page/slide citations from tutor examples.
- Show hints, reveals, and assisted attempts honestly; reading is not mastery.
- Browser progress stays local until the learner copies a revision-bound command
  into Neura. Show stale-board rejection and unverified resumed sources clearly.
- Generate standalone escaped HTML/SVG with a fixed CSP and no remote resources.
  Verify actual behavior and axe results at 390 and 1280 pixels.

## Direction contract

<!--
THESIS: Neura launches with one unmistakable wordmark and no competing content.
OWN-WORLD: Tungsten neutrals, burnt copper, bone text, flat one-cell rules.
STORY: Operator sees Neura, then starts work in composer.
FIRST VIEWPORT: The NEURA wordmark alone.
FORM: Operate-mode terminal instrument; focused, responsive, and state-driven.
-->

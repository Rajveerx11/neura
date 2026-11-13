# Neura design system

Updated 2026-11-07 for the active Mastra CLI and Learn boards. Historical Pi
cockpit designs remain in [source history](plans/README.md). They are not current
requirements. Implementation details and dated acceptance live in
[terminal UX](docs/TERMINAL_UX.md).

## Direction

Forged Tungsten uses neutral dark surfaces, burnt copper and bone text. Keep the
terminal quiet until work, a decision or evidence needs attention. Text must
communicate meaning without color. Do not imply readiness or verified completion
from a decorative state.

## Tokens

| Token | Value | Role |
| --- | --- | --- |
| Canvas | `#0b0c0e` | Background |
| Surface | `#14171a` | Grouped content |
| Raised | `#1c2024` | Selected surface |
| Border | `#2c3237` | Inactive separation |
| Copper | `#d97841` | Focus and primary action |
| Bone | `#e8e2d8` | Primary text |
| Muted steel | `#a8a39b` | Supporting metadata |
| Dim | `#7a828b` | Inactive/historical text |
| Learn blue | `#86a7d7` | Information and Learn |
| Success | `#69c08a` | Supported successful outcomes |
| Warning | `#d3a64a` | Approval or degraded operation |
| Error | `#df6b63` | Blocked/failed outcomes |

Use monospace in the terminal and sentence case for actions. Keep phase/verdict
labels short. Avoid ambient gradients/glows and decorative motion. Use no emoji.

## Launch and conversation

`src/brand.ts` supplies the approved static prompt-to-result mark. Startup
loads no image/font dependency. Show the logo, prompt-adjacent status and real
readline prompt. There is no image-backed Terminal profile or Pi editor in the
active application. Do not add a banner or readiness claim.

Status prints once at launch. Chat turns print the answer, with one short line
per tool call. Failed/blocked/cancelled outcomes remain visible. `/status` holds
provider/model, workspace, history and reported last-turn tokens. Usage is not
context occupancy. Capacity remains unknown. Label an answer only when separating
it from a provider-supplied reasoning summary. Hidden reasoning is never displayed.

`--ascii`, `TERM=dumb` and narrow terminals fall back to `>_ neura`.
`NO_COLOR`, including an empty value, disables color. Dumb terminals retain
plain-text meaning without cursor control. Headless, help and check output omit
artwork. Sanitize control characters and preserve structured output.

## Decisions and width

Approvals show the exact complete action and require `yes`. Denial/cancellation
does not grant authority. Keep decisions readable at narrow widths and never
truncate a sensitive action into an incomplete approval. Ctrl+C cancels running
work. Do not retry the task automatically.

Validate output at 40, 56, 72, 80, 92 and 120 columns with long paths, model IDs
and Unicode. Preserve plain/non-TTY behavior. The static logo is five lines,
mark only, with no name beside it. Old Pi widget limits do not imply an active Pi UI. Work and Learn are
the everyday modes, and YOLO is an explicit opt-in. No Shift+Tab mode cycle or `/dash` is implemented.

## Learn boards

Teach one concept with short bullets, an example and a practical next step.
Use small flow, ER or sequence diagrams with text alternatives and narrow-screen
scrolling. Keep controls keyboard-accessible. Separate source citations from
tutor examples, record assistance and label historical resumed excerpts.

Boards use escaped standalone HTML/SVG, fixed CSP and no remote resources.
Browser progress returns through copied revision-bound terminal commands, never
silent synchronization. Test real Edge interaction and axe at narrow/desktop
widths. Preserve readable source excerpts and explicit save/resume semantics.

Approved vector, PNG and terminal assets live in [assets/brand](assets/brand/README.txt).
Artwork approval does not clear trademark, redistribution, dependency or
production gates.

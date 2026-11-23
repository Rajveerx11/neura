# Screenshot provenance

## Native terminal captures

Captured 2026-11-23. These PNGs show the actual installed `neura` process (source
`28fef90`) in Windows Terminal on Windows 11, not an HTML/SVG reconstruction or a
scripted renderer. Each is an unretouched 1153 × 544 window capture at 100 columns by
22 rows, using the owner's terminal font (CaskaydiaCove Nerd Font Mono 11). No
generated artwork, model output or replacement text was composited into the images.

| Asset | State shown |
| --- | --- |
| [terminal-commands.png](terminal-commands.png) | `/` opens the live command menu |
| [terminal-skills.png](terminal-skills.png) | `$` opens the installed-skill menu, reading this PC's shared skill directories |
| [terminal-clear.png](terminal-clear.png) | `/clear` confirms a new chat and returns to the Work prompt |
| [terminal-shell.png](terminal-shell.png) | Typing `!git status` switches the prompt into pink shell mode (not submitted) |

The process used an empty task-owned `neura-demo` workspace, an isolated
`NEURA_HOME`, `--no-history`, `--provider local` and `--model offline-demo`.
The model label was chosen for the capture. No inference, authentication,
workspace writes, shell command or skill execution occurred. Only installed skill
names and menu descriptions were shown. The skill count is specific to this machine.
The `/clear` capture starts from an idle chat, so it demonstrates the command
and prompt, not deletion of a previous model exchange.

Two capture-only aids were used. Keystrokes were written with `WriteConsoleInput`
into that one task-owned console, so no other window received input. A Node
`--import` preload replaced the status bar's user name with `demo`; the shipped
CLI shows the real Windows user name. Windows were captured with the `PrintWindow`
API, so no other desktop content appears.

To reproduce the visible states, launch the development CLI in a disposable
empty workspace with a separate `NEURA_HOME`:

```powershell
neura --cwd C:\path\to\neura-demo --no-history --provider local --model offline-demo
eura-demo --no-history --provider local --model offline-demo
```

Type `/` for the first view, `$` for the second, `/clear` and Enter for the
third, and `!git status` (without Enter) for the fourth. Capture only that
terminal window with the operating system's screenshot tool. Do not
submit a model task or include private paths in a public image. Exit with
`/quit`. Remove only the workspace and home you created for the capture.

The main README embeds the pixel wordmark SVGs from [assets/brand](../brand/README.txt)
and two of these terminal captures. The earlier logo PNGs, architecture
illustration and fixture-based Learn preview remain in the repository.

## Learn renderer fixture captures · 2026-11-08

These are real captures of [`learn-renderer.ts`](../../agent/neura/learn-renderer.ts)
on native Windows Microsoft Edge, using only the repository's
[synthetic booking fixture](https://github.com/Rajveerx11/neura/blob/1d4964a4f879fafc32d6fb74a0e575c7c77c0e5d/scripts/learn-workshop-fixture.mjs). They contain
no private documents, workspace content, learner history, accounts or credentials.
No model request or real PDF import was made. The displayed `database-lecture.pdf`,
page 7 and all-`a` SHA-256 identifier are fictional fixture metadata.

| Asset | View and capture |
| --- | --- |
| [learn-workshop-desktop.png](learn-workshop-desktop.png) | Initial lesson; 1280 × 1000 viewport |
| [learn-sql-lab.png](learn-sql-lab.png) | SQL variant using `sqlExercise`; complete `#practice` panel |
| [learn-curriculum.png](learn-curriculum.png) | Complete `#curriculum` panel; rows → keys → joins, keys current, rows completed |

All captures use a 1280 × 1000 CSS-pixel desktop viewport at 1× scale. Panel captures
omit surrounding blank space; no UI, text, styles or pixels were retouched.
The accepted curriculum and completion statuses are supplied synthetic state, not
an actual learner's achievements. The lesson route is a lesson outline, distinct
from the prerequisite curriculum. Screenshots do not establish production readiness,
provider entitlement, accessibility certification or mastery.

The historical reproduction block checked desktop overflow, page errors and attempted
external requests while capturing the three views. The browser verifier checked
390-pixel layouts, exercise focus, revision-bound answer handoff, keyboard,
CSP and axe regressions. A screenshot alone is not evidence that those tests passed.

## Historical reproduction

The fixture and browser regression verifier were removed on 2026-11-17.
The screenshots remain dated presentation evidence. Reproduction commands
belong to the [original checkout](https://github.com/Rajveerx11/neura/blob/1d4964a4f879fafc32d6fb74a0e575c7c77c0e5d/assets/screenshots/README.md).

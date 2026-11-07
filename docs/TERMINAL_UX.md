# Active terminal UX

Current behavior, 2026-11-07: approved logo, startup status and prompt; chat turns
print only the answer. Tool calls, approvals, warnings and review outcomes remain
visible; `/status` holds detailed usage. The “Answer-only chat” section below
supersedes older per-turn footer/status designs. See [current design](../DESIGN.md).
Earlier audit/test sections remain dated evidence, not new acceptance.

Audit baseline: `5f53c11`, 2026-11-02. Scope: [active CLI](../src/cli.ts),
[CLI tests](../tests/v1-cli.test.ts), [status](STATUS.md), and
[design direction](../DESIGN.md). Findings describe that baseline; replacement
rendering is evaluated separately below. Retained Pi widgets, shortcuts and
ten-line limits do not establish Mastra behavior.

## Implemented in this pass

- Pure dependency-free presentation shared by the CLI and offline preview.
- Copper identity/focus, neutral activity and answers, textual warning/error
  states. No alternate screen, animation, dashboard or startup model request.
- Launch identity is the owner-approved context-into-action mark from `src/brand.ts`
  (uncolored; `>_ neura` for `--ascii`, `TERM=dumb` and narrow terminals). It
  replaces the interim `o--o neura` mark used while this work was in a worktree.
- Prompt-adjacent status and `/status` details: actual mode/model/workspace,
  history/session state, thinking-summary setting and conversation message count.
  Validated Mastra total usage is labelled last-turn input/output, never context
  occupancy. Missing counts stay unavailable; context-window capacity stays unknown.
- Grouped help, complete model IDs and approval details,
  explicit answer boundaries, readable sessions, blank-input reprompt and
  cancellation/recovery feedback. Tool lifecycle phases remain visible, with
  less whitespace; a returned tool is not presented as verified success.
- TTY-aware styling with plain redirected output, `NO_COLOR` and `TERM=dumb`.
- Native readline close cancels pending questions and active requests. An actual
  80-column Windows Node PTY exposed an unresolved idle Ctrl+C promise; the fix
  now closes on Ctrl+C/EOF and releases synthetic history leases. A real-readline
  stream regression covers idle interrupt, EOF and EOF during approval.

Remaining limitations: status/prose use approximate grapheme/display-cell sizing,
not exhaustive terminal-specific Unicode width rules; older metadata packing
still uses string lengths. Long unbroken values, model code and exact
approval actions rely on terminal soft wrapping. Verification receipts remain
JSON; no new proof summary is implied. Native PTY acceptance covered editing,
blank input, mode changes, errors, empty history, idle Ctrl+C and EOF at 80 columns;
it did not establish live-provider cancellation, screen-reader support or every
terminal/resize combination. Preview images are synthetic helper output, not
screenshots of a live model task.

## Existing defects at the baseline

| Source behavior | User-visible defect | Acceptance target |
|---|---|---|
| `say()` removes all terminal styling; fixed wordmark and no column handling | Forged Tungsten identity is absent beyond plain text; long help, catalog, error and approval lines rely on terminal wrapping | Width-aware presentation; optional copper with readable plain output |
| `onToolEvent` prints each requested/started/returned phase | Routine tool activity overwhelms short answers | Quiet milestones; keep failed/denied outcomes visible without arguments or returned payloads |
| `[answer]` appears only after a reasoning summary | Ordinary answers lack a consistent boundary; streamed text can meet tool events mid-line | Stable answer boundary; complete line before tool/status text |
| `/sessions` and `/verify` print indented JSON interactively | IDs and receipts dominate scrollback; next action is hard to find | Compact interactive summaries retaining exact identifiers and honest verification state; preserve machine output |
| Empty input reaches `turn()` | Enter at an idle prompt produces a task-validation error | Empty Enter reprompts without a model request |
| Interrupts surface generic abort errors; idle interrupt closes readline | Cancellation and exit are poorly distinguished | Explicit cancelled state during an operation; idle exit releases listeners and writer lease |
| `NO_COLOR`, `TERM=dumb` and widths are not consulted | No defined progressive fallback; redirected stdout with TTY stdin and no task silently reaches the absent-readline catch | Explicit noninteractive input error; plain deterministic output |
| Tests stub readline and assert text fragments | No real terminal editing, resize, width, color or EOF acceptance evidence | Renderer matrix plus focused actual readline/PTY checks |

These are presentation findings, not permission to change tools, approvals,
providers, model selection, sandbox policy, history or proof semantics.

## Interaction contract

- Launch shows the compact identity and prompt-adjacent status before the real
  Work/Learn prompt. The owner explicitly requested status in the follow-up.
  No dashboard, panels, alternate screen, readiness banner or startup provider
  call. Scratch-home launches retain the actual workspace and persistence warning.
  Status refreshes at input boundaries; it is not pinned during scrolling.
- Work is default. Only `/mode work` and `/mode learn` select modes. Keep existing
  `/help`, `/model`, `/thinking`, `/learn`, `/new`, `/sessions`, `/resume`, `/status`,
  `/verify`, `/login`, `/logout` and `/quit` behavior. Do not borrow Pi shortcuts
  such as Shift+Tab or advertise unavailable modes/commands.
- Preserve ordinary readline editing and Enter submission. Empty Enter is idle.
  Do not claim multiline, autocomplete, Escape cancellation or editor parity
  without implementation and keyboard evidence. Long pasted text cannot create
  an implicit approval; test queued input at the next approval boundary.
- `/model` lists provider-advertised choices; number or exact listed ID selects.
  Bad input reprompts; Enter cancels with model unchanged. Selection starts a
  fresh conversation. Cancellation/rejection never replays the task, guesses
  another model or switches billing providers.
- During a turn, show a bounded waiting milestone, tool outcomes and a clear
  answer boundary. Reasoning summaries stay labelled, optional and separate;
  `/thinking off` and `--no-thinking` suppress them. Never imply hidden reasoning
  is available. Keep transcript scrollback and normal selection/copy intact.
- Ctrl+C during catalog fetch, inference, login or approval cancels that operation
  and returns to the prompt. Ctrl+C while idle and EOF exit cleanly. An aborted
  operation cannot approve or start a pending action. Cancellation does not claim
  rollback of effects already completed; inspect state before a manual retry.
- Approval owns the next input. Show exact action, boundary and one-use scope;
  soft wrapping must not change or omit command bytes. Default is no. Only the
  existing explicit `yes` response grants approval; Enter, `no`, invalid input,
  EOF and cancellation grant nothing. Headless approval stays denied. Do not
  hide this decision behind a generic spinner or success color.
- Errors identify blocked/failed/cancelled outcomes in words, with existing safe
  recovery guidance. Never print credentials, raw provider bodies, tool payloads
  or private session content. Sanitize untrusted control sequences before styling.
- Learn exposes its existing lesson/answer/hint/reveal/save/resume commands and
  local board handoff. Reading, hints and resumed sources are not mastery or
  verified provenance. `/verify` remains Work-only; detector-only is never verified,
  full proof remains blocked, receipts stay session-local metadata.

## Width and fallback contract

Target for broader Unicode support: use terminal display cells, not string
length; account for ANSI, combining marks, wide characters and tabs. This pass
adds approximate grapheme sizing for status and prose; it does not establish
all emoji, ambiguous-width glyphs or terminal font combinations.
Preserve safety meaning before decoration. Wrap human
prose without horizontal overflow; never shorten an approval's exact action.
Long paths, IDs and URLs need lossless wrapping or a separately copyable full
value. Keep raw machine-readable records byte-valid rather than visually wrapping
them. Resize affects subsequent output without rewriting prior scrollback.

| Columns | Required behavior |
|---:|---|
| 40 | Compact identity; stack metadata; keep mode, decision/default, failure and recovery legible |
| 56 | Wrap help, model choices and long action descriptions; retain full identifiers |
| 72 | Quiet transcript with answer, summary and tool boundaries; no fixed-width footer |
| 92 | Comfortable prose measure; secondary details remain on demand |
| 120 | Keep restrained text measure and negative space; no new columns/panels |

Also preview 80 columns for common terminals. Test all widths with long paths,
catalog IDs, unbroken text, Unicode and multiline exact actions. A PNG/SVG cannot
establish input editing, signal handling, resize behavior or screen-reader support.

- Capable interactive TTY: canvas `#0b0c0e`, copper `#d97841`, bone `#e8e2d8`,
  dim neutrals from DESIGN.md. Semantic colors only accompany textual outcomes.
  No cursor animation or permanent activity chrome is required.
- `NO_COLOR` present: no color escapes, including an empty value. Identity and
  safety labels remain understandable without hue.
- `TERM=dumb`: plain text, no cursor movement, clearing, animation or dependence
  on block-glyph alignment. Keep all decisions accessible through ordinary input.
- Piped output: no logo, interactive prompt, picker question, ANSI or cursor
  controls. Explicit `--prompt` also suppresses interactive questions/identity;
  presentation labels may retain color when their own output stream is a TTY.
  Keep answers on stdout and diagnostics on stderr. Preserve `/sessions`,
  `/verify` and `--check` machine records; human
  verification explanations must retain existing fail-closed meaning.
  Noninteractive stdin without an explicit task fails clearly; do not start
  inference by consuming an arbitrary pipe. A positional task remains supported.

## Offline preview

[Preview script](../scripts/preview-terminal-ui.mjs) uses Node built-ins only.
It imports `createTerminalUI({ isTTY, columns, env })` from the integrated
`src/terminal-ui.ts`, or an explicit trusted local `--module PATH`. That module
must be reviewed, pure and free of CLI/provider/session imports; importing
arbitrary JavaScript is code execution, not a sandbox. Without a real export,
the preview fails rather than drawing an invented implementation.

```powershell
node scripts/preview-terminal-ui.mjs --scenario empty --width 40 --output empty-40.svg
node scripts/preview-terminal-ui.mjs --scenario approval --width 80 --output approval-80.svg
node scripts/preview-terminal-ui.mjs --scenario error --width 120 --output error-120.svg
node scripts/preview-terminal-ui.mjs --scenario help --width 56 --format text
```

Scenarios: `empty`, `work`, `learn`, `error`, `approval`, `help`, `models`, `status`.
The empty/status fixtures consume the same new status helpers as the CLI.
All text beyond the real helpers' labels is synthetic fixture content. A label
outside the terminal transcript makes that explicit. No live task, approval,
login, file command or inference runs. SVG converts the renderer's actual
truecolor SGR foregrounds into escaped XML text spans; unknown controls/styles
fail explicitly. It simulates lossless terminal hard wraps, not renderer width
conformance. Grapheme widths are approximate outside these ASCII/block fixtures.
`--plain` exercises empty `NO_COLOR`; `--format text` emits unstyled logical
lines for inspection. Existing output files are never overwritten. Preview
snapshots exercise helpers, not exact CLI event order or policy enforcement.

## Acceptance checklist

- [ ] Inspect actual generated empty, Work, Learn, error and approval output at
  40/56/72/80/92/120 columns, with synthetic inputs clearly labelled.
- [ ] Confirm compact identity, real status and prompt at launch; no provider
  calls or false ready/verified/completed state.
- [ ] Exercise normal editing, blank input, invalid commands, model selection,
  Enter cancellation, Ctrl+C idle/busy/approval and EOF. Verify cleanup and no
  automatic task retry.
- [ ] Positive approval grants once to the exact action. Negative/default/EOF/
  cancellation and pasted queued input cannot grant accidentally. Test through
  the real CLI; pictures alone are insufficient.
- [ ] Check plain/color, `NO_COLOR` (empty and nonempty), `TERM=dumb`, redirected
  stdout, piped stdin, positional task and explicit `--prompt` combinations.
- [ ] Keep structured output parseable, control sequences sanitized, provider
  bodies/private data absent, reasoning suppression and tool boundaries intact.
- [ ] Keep Learn execution denial, full-proof block, `verified:false`, provider
  choice, workspace/history boundaries and existing active tests unchanged.
- [ ] Run parent integration typecheck, focused CLI/renderer tests, docs and diff
  checks; run full active harness once after integration. Record actual results.

## Earlier first-pass verification (2026-11-02)

Executed with native Windows Node v24.19.0 in the isolated UI worktree:

| Command/check | Result |
|---|---|
| `node.exe scripts/verify-harness.mjs` | Exit 0; 16/16 active suites passed. The CLI suite in this run preceded the final readline-close fix. |
| `node.exe --test tests/v1-terminal-ui.test.ts tests/v1-cli.test.ts` | Exit 0; 24/24 passed after the final fix, including real-readline close and approval-EOF regressions. |
| `node.exe node_modules/typescript/bin/tsc -p tsconfig.v1.json` | Exit 0. |
| `node.exe scripts/check-docs.mjs` | Exit 0; seven registered current documents. This audit is additionally checked for local links and whitespace. |
| `node.exe scripts/check-pi-free.mjs` | Exit 0; 208 lock entries and 32 reachable local modules. |
| `git.exe diff --check` | Exit 0. |
| `node.exe --check scripts/preview-terminal-ui.mjs` | Exit 0; 84 integrated helper fixtures also passed deterministic/XML/control checks. |
| Native 80-column PTY | Backspace editing, blank input, modes, unknown-command recovery, empty sessions, idle Ctrl+C and EOF observed. Final shutdown fixture exited 0 with `PTY_HISTORY_LEASES_RELEASED` and `PTY_FIXTURE_CLEANED`. |

The first native Ctrl+C probe exited 13 with an unsettled top-level await; the
close-signal fix and regression tests address that observed failure. The full
harness was run once, followed by the focused suite after the fix. Live sandbox
execution and POSIX-only probes are not established by Windows contract tests.
## Integration onto main (2026-11-04)

The worktree was removed during a cleanup on 2026-11-03 before this work was
committed. It was restored from Cloudroom's safety-snapshot commit, which matches
the verified recovery archive, and merged onto `main` together with the review
workflow and approved branding:

- `src/cli.ts` keeps the review workflow, `/workflow`, `/review`, `/reviewer`,
  reviewer flags and `--ascii`; help lists them in grouped sections.
- Launch prints the approved logo, a blank line, prompt-adjacent status and the
  real prompt. There is still no banner, readiness claim or startup provider call.
- Workflow fix turns reuse the outer request's cancellation. Last-turn usage covers
  the whole request: the user's turn plus its fix turns. Any unreported count makes
  the total unknown. Reviewer calls are not included.
- A workspace without a Git baseline gets a once-per-session `Review unavailable`
  notice in place of the earlier once-per-session `BLOCKED` line, which looked
  like a failure after a plain chat turn. Explicit `/review`
  still reports `BLOCKED` when no baseline exists.
- The first-pass preview PNG and the LinkedIn captures were not committed. They
  show the superseded identity. They remain in the recovery archive.

## Quiet chat transcript (2026-11-04)

Synthetic transcripts after the integration still repeated a three-line status
block after every turn. They also showed `[answer]` on every reply, three lines
per tool call, and `Review skipped: no workspace changes.` after plain chat.
Changes:

| Before | Now |
| --- | --- |
| Full status block before every prompt | Full block at launch and whenever mode, model, session, history or thinking changes; otherwise one dim footer: `model · N msgs · X in · Y out tokens · /status`. Empty Enter reprompts without reprinting it. Approvals and the `/model` picker no longer print status mid-flow. |
| `[thinking] Waiting for model response...` stays in scrollback | On ANSI terminals the line is erased when output starts and shown again while the model works after a tool returns. `TERM=dumb` keeps it as a plain line. The catalog fetch on the first turn uses the same line in place of `Fetching the subscription model catalog...`. |
| `[answer]` before every reply | Only after a labelled reasoning summary, the one place it separates two sections |
| `[tool] read: requested`, `started`, `returned` | One line, `[tool] read`. `failed`, `blocked` and `cancelled` still print their own line |
| `Review skipped: no workspace changes.` after each chat turn | Automatic review prints nothing when nothing changed. Explicit `/review` still reports the skip. Trivial-change reasons no longer end in doubled punctuation. |
| Long `Review unavailable` sentence | Shorter, dim and wrapped, still once per session |
| Typing `exit` sends it to the model | Bare `exit` or `quit` closes Neura interactively. `neura -p exit` remains a task. |

Approval text, cancellation wording, error output and `/status` details are
unchanged. Evidence is synthetic: the `v1-cli`, `v1-terminal-ui` and
`v1-workflow` tests plus the full harness.

## Answer-only chat (2026-11-06)

A real `hi` turn still printed a model line, a review notice and a status block
around a one-line reply. A chat turn now prints the answer and nothing else:

| Before | Now |
| --- | --- |
| `Model: X (subscription catalog default)...` on the first turn | Removed. `/status` shows the model; `/model` still confirms a change. |
| `Review unavailable` after the first turn in a non-Git workspace | Printed only after a turn that started a non-read-only tool, still once per session |
| Status block or footer before each prompt | Status prints once at launch. The footer is gone. `/mode`, `/model`, `/thinking` and `/new` already confirm their own changes. Token usage is in `/status`. |

Tool lines, approvals, warnings, errors and review outcomes for real changes stay
visible. This section supersedes the status and notice rows above. Evidence is
synthetic: `v1-cli`, `v1-terminal-ui` and the full harness.

## Follow-up: identity, status and live captures (2026-11-02)

[Research and design decisions](TERMINAL_STATUS_RESEARCH.md) cite the reviewed
OpenCode and Pi source. No upstream UI code or packages were imported.

Final sources were stable before this integrated verification:

| Command/check | Result |
| --- | --- |
| `node --test --test-concurrency=1 tests/v1-terminal-ui.test.ts tests/v1-cli.test.ts tests/v1-runtime.test.ts` | Worker: exit 0, 63/63 passed, 81.84 seconds. |
| `node.exe scripts/verify-harness.mjs` | Parent: exit 0, 16/16 suites passed after all status fixes; final chained checks completed in 168.60 seconds. |
| `node.exe node_modules/typescript/bin/tsc -p tsconfig.v1.json` | Parent: exit 0. |
| `node.exe scripts/check-docs.mjs` | Parent: exit 0, seven registered current documents; new deliverable documents additionally checked for links/whitespace. |
| `node.exe scripts/check-pi-free.mjs` | Parent: exit 0, 208 lock entries and 32 reachable modules. |
| `git.exe diff --check` | Parent: exit 0. |
| `node.exe --check scripts/preview-terminal-ui.mjs` | Exit 0; 96 deterministic actual-export fixtures, unsupported-control rejection and XML escaping passed. |
| Independent review | Status/usage focused checks passed; fixed and rechecked maximum-count narrow overflow and raw ANSI in capable-TTY one-shot `/status`. |
| Actual Windows ConPTY -> live xterm -> Edge | Exit 0; Work startup, Learn switch, thinking off, `/status`, `/new`, idle Ctrl+C and three screenshots; no browser page errors. |

Live captures (actual CLI output in a disposable workspace with network disabled
and an unconnected local-model label, not provider-response demos) and a LinkedIn
draft were made in the worktree. They predate the approved logo and are kept only
in the recovery archive, not in the repository.

The full harness contains synthetic positive and negative contracts. Live WSL
sandbox replay and POSIX-only process probes are not established by this Windows
run. Login/logout/save-failure status branches were source-reviewed, not manually
exercised with real accounts. Approximate Unicode widths and input-boundary-only
status refresh remain limitations. Context capacity stays unknown; last-turn
usage is not context occupancy. Existing local-provider retry behavior is outside
this UI change; no all-provider no-retry guarantee is made.

## Readiness boundary

Development/testing only, not production-ready or feature parity. As documented
in [status](STATUS.md) and [Mastra v1](MASTRA_V1.md), bundled Mastra EE scope and
distribution approval remain unresolved; `verify:release` stays blocked. Full
trusted proof, durable effect recovery, clean-host installation/recovery and
original security hardening remain open. Human Away is unavailable in v1.
UI snapshots do not close those gates or certify live credentials, entitlement,
refresh/restart behavior, WSL proof execution or unattended operation.

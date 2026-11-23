# Using Neura

Neura is for development and testing with synthetic, non-sensitive data.
[Install from source](../README.md#quick-start-from-source), then run `neura`
in a project separate from the Neura checkout, its private home and Pi profiles.
`--cwd PATH` sets the project explicitly. Launching interactively from your home
without a project opens a scratch workspace. `/status` shows which path is in use.

```powershell
neura --cwd C:\path\to\project
neura --cwd C:\path\to\project --mode learn
neura --cwd C:\path\to\project --prompt "Summarize the project structure" --no-history
```

`--prompt` runs one turn and cannot grant approvals. Policy-allowed Work commands
can still run in the sandbox. `--no-history` disables chat persistence, not credential
writes or Learn artifacts. `neura --help` lists current flags.

## Providers

| Provider | Setup |
| --- | --- |
| ChatGPT subscription (default) | Run `/login` and then `/model`. See [sign-in, refresh and troubleshooting](CODEX_AUTH.md). No fallback to paid API billing. |
| Local OpenAI-compatible server | Start your server separately. Launch with `--provider local --model NAME --base-url http://127.0.0.1:8080/v1`. |
| OpenAI or Anthropic API | Set `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`, then select `openai` or `anthropic` and a model explicitly. |
| OpenRouter or AIRouter.in | Set `OPENROUTER_API_KEY` or `AIRROUTER_API_KEY`. Use `/model openrouter` or `/model airouter`, or select the exact model ID. Both use fixed endpoints. |

Choose a gateway chat model that supports tools. To resume a gateway chat, select
the original provider and model first. OpenRouter must allow Neura to disable its
web plugin per request. Gateway calls are billed through the chosen gateway.
For a Google AI consumer subscription, use Google's Antigravity as a separate
agent. See [T3 provider setup](T3_CODE.md#accounts-and-models).

## Commands

Type `/` to open the command menu. Use Up/Down to select, Tab to complete, Enter
to run, and Esc to close. `Ctrl+C` cancels a turn.

| Command | Purpose |
| --- | --- |
| `/help`, `/status` | Show commands or current mode, model, workspace and usage. |
| `/model [PROVIDER]`, `/model PROVIDER MODEL [URL]` | Browse available catalogs or select a model explicitly. |
| `/thinking on\|off` | Toggle provider-supplied reasoning summaries. |
| `/mode work`, `/mode learn`, `/mode yolo` | Switch modes. YOLO requires confirmation. |
| `/new`, `/clear`, `/sessions`, `/resume ID` | Start a fresh chat or select a saved one. |
| `/reconcile` | Acknowledge inspection after an uncertain task. Does not replay actions or clear crash locks. |
| `/workflow on\|off`, `/review`, `/review status` | Control Work review or inspect its receipt. |
| `/reviewer PROVIDER MODEL [URL]`, `/reviewer default` | Select a reviewer or follow the builder. |
| `/subagent` | List roles, delegate a Work task, or manage a named subagent. |
| `/verify quick`, `/verify full`, `/verify status` | Check the candidate or inspect a receipt. Full verification is unavailable. |
| `$`, `$NAME TASK` | Browse or apply [installed skills](SKILLS.md). |
| `/learn` | Lesson commands, hints, answers and explicit save/resume. |
| `/quit`, `/exit` | Close Neura. |

## Manual test in a disposable workspace

```powershell
$workspace = Join-Path $env:TEMP ("neura-smoke-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $workspace | Out-Null
'alpha' | Set-Content -Encoding utf8 -Path (Join-Path $workspace 'sample.txt')
neura --cwd $workspace --check
neura --cwd $workspace --no-history
```

Ask Work to read `sample.txt` and create `result.txt` containing `beta`, then
inspect the files. For command execution, use a standalone Git checkout with
its own `.git` directory. Linked worktrees cannot run Work commands. The sandbox
is offline, so install project dependencies separately. Work review requires a
committed Git baseline and never commits, pushes or merges.

Switch to `/mode learn` and ask for one concept, a worked example and an exercise.
Use `/learn answer TEXT` to answer or `/learn hint` for help. The browser can
prepare a command you paste back into Neura. See [lesson workflow](LEARN_MODE.md).

## Loops and schedules

In interactive Work, `/loop 15m Summarize recent commits` repeats a task.
`/schedule in 30m TASK` runs once after a delay, and `/schedule at TIMESTAMP TASK`
accepts an ISO timestamp with a time zone. Repeats need at least one minute.
Use `/schedule list` and `/schedule cancel ID` to manage the queue.

Tasks wait for an idle prompt with no input. Schedules use normal Work approvals.
A loop stops on failure, denial or an unfinished turn. Missed intervals are skipped.
Exit or switch mode, model or conversation to clear the queue. Schedules do not run
in the background after Neura exits.

## Subagents in Work

Ask Neura to delegate in a Work prompt, or start a subagent directly.

```text
/subagent scout Map the entry points under src
/subagent reviewer Check the current implementation for cancellation bugs
/subagent list
/subagent wait scout
/subagent message scout Include paths for the callers you found
/subagent cancel reviewer
```

Scouts and reviewers run in parallel with read-only workspace tools. The terminal
status bar shows how many subagents are running. It posts completion notices
when the prompt is idle. `/subagent wait NAME` shows the report or a pending
question. `/subagent message NAME TEXT` replies or continues the same child
conversation. A running child can queue one follow-up. The next Work prompt
includes excerpts from new reports so Neura can use them without starting a
turn on its own.

Use `/subagent worker TASK` to delegate changes. A worker runs within a
supervised Work turn, with the same file rules, offline sandbox and approval
prompts. It pauses at a question so the parent can answer before work continues.
Neura can also call `subagent`, `subagent_message`, `subagent_wait`,
`subagents_list` and `subagent_cancel` from its own Work turn. Inspect results
before relying on them. A reviewer subagent uses the parent model and does not
issue an independent review receipt.

Children use the current workspace, provider and model. Their context starts
with the delegated task and project guidance. Child conversations live in
memory. Reports returned through parent tools can enter saved parent history.
Switching mode, model or conversation or exiting clears the registry and
cancels active children. A session supports up to 12 named children, three
concurrent runs and six turns per child. Subagents cannot spawn their own
children and are unavailable in Learn and YOLO.

The named-agent workflow was inspired by [pi-interactive-subagents](https://github.com/amosblomqvist/pi-interactive-subagents).

## Manual verification

`/verify quick` runs the pinned Proof-of-Work detector after interactive approval.
It needs a committed Git root and configured offline proof artifacts inside WSL.
Detector receipts never attest that tests ran. `/verify full` is unavailable.
See [receipt scope and prerequisites](VERIFICATION.md).

## YOLO

`neura --yolo` is explicit consent to run without a sandbox or approvals. In a
running session, `/mode yolo` requests confirmation. `exec` starts a fresh shell
on each call and accepts a working directory. YOLO has no automatic review,
checkpoint or undo. Return to `/mode work` or exit. The mode is never saved.
Read [YOLO limits](../SECURITY.md#yolo-has-no-boundary) before using it.

## Terminal and data

`--ascii` uses an ASCII launch logo. `TERM=dumb` disables the interactive composer
and animation. `NO_COLOR` turns off color. See [terminal UX](TERMINAL_UX.md).

Neura keeps credentials and chat history under `~/.neura` or `NEURA_HOME`.
Learn boards and snapshots use the workspace's `.neura-learning` directory.
Neura does not import a Pi profile. See [security](../SECURITY.md) for data and
containment limits and [support](../SUPPORT.md) for troubleshooting.

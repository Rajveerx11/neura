<p align="center"><img src="agent/neura/launch-artwork.png" width="190" alt="Neura logo"></p>

# Neura: Mastra development build

Windows-first engineering and learning assistant. The active source uses
**Mastra, not Pi**, with two modes:

- **Work:** workspace reads, hash-bound writes/edits and explicitly confirmed,
  network-disabled WSL2/bubblewrap commands. Missing isolation fails closed.
- **Learn:** lessons, local PDF/PPTX imports, English OCR, cited HTML boards,
  exercises, hints and explicit save/resume. Obsidian capture is opt-in.

**Development/testing only, not a production release.** Use synthetic,
non-sensitive test projects and materials, not end-user, customer or
business-operational data. Mastra's EE scope and distribution permission remain
unresolved. Local installation does not clear those restrictions or establish
production readiness.

The package metadata remains `2.6.0-rc.1`. Mastra core is pinned to `1.79.0`.
“v1” names this implementation slice, not a published Neura version. Latest
published Neura `2.5.1` is the older Pi product, not this application. The
source-linked launcher runs the current checkout, including uncommitted edits.
It is not a sealed or automatically updated release. See [status](docs/STATUS.md),
[implementation and evidence](docs/MASTRA_V1.md) and
[dependency review](docs/MASTRA_V1_DEPENDENCIES.md).

## Prerequisites

- Native Windows with Node `24.15+` and npm. Tested locally with Node `24.19.0`.
  First Learn-store creation requires native Windows, not a Node process in WSL.
- An ASCII-only checkout path for the development launcher. The installer
  refuses non-ASCII paths and unsupported command-shell characters before writes.
- Both locked dependency graphs, installed with lifecycle scripts disabled.
- For Work commands: WSL2 and bubblewrap in the selected distribution. Work
  commands have no host fallback and no network. `--check` does not test WSL or
  sandbox execution. `NEURA_WSL_DISTRO` can select a nondefault distribution.
- A browser for Learn's generated HTML boards and optional subscription sign-in.
- A private Neura home outside the test workspace. Windows DACL privacy must be
  checked before signing in. See [authentication](docs/CODEX_AUTH.md).

No Pi installation, global npm update or legacy-profile import is needed.
The installer does not bootstrap Node, WSL, bubblewrap or a model server.

## Prepare the source checkout

Run these commands in the Neura checkout:

```powershell
node --version
npm ci --ignore-scripts
npm ci --prefix agent/neura --ignore-scripts
node src/cli.ts --help
node src/cli.ts --check
```

An optional development launcher points to this checkout:

```powershell
powershell -NoProfile -File .\install.ps1 -Development
powershell -NoProfile -File .\install.ps1 -Check
Get-Command neura -All
neura --help
neura --check
```

Review command discovery before using `neura`. `-Check` does not install or repair
anything. The development installer preserves unknown or modified launchers.
Replacement of a receipt-owned legacy launcher keeps a backup. It does not alter
standalone Pi. Do not overwrite a launcher that the installer refuses.

If you skip the launcher, replace `neura` below with `node` followed by the
absolute path to this checkout's `src/cli.ts`. Keep the explicit `--cwd` workspace.

## Manual test in a disposable workspace

Keep the test project outside the Neura checkout and its parents/descendants,
outside the Neura private home and outside any Pi profile. Neura protects its own
runtime against writes and refuses commands from overlapping workspaces.

In a fresh PowerShell terminal:

```powershell
$workspace = Join-Path $env:TEMP ("neura-smoke-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $workspace | Out-Null
Set-Location $workspace
'alpha' | Set-Content -Encoding utf8 -Path sample.txt
neura --cwd $workspace --help
neura --cwd $workspace --check
```

These two checks need no credentials or model requests. They do not prove
subscription entitlement, sandbox readiness or a successful Learn lesson.

### Choose a provider deliberately

For an already running, non-production local OpenAI-compatible model on loopback:

```powershell
neura --cwd $workspace --provider local --model qwen3-coder --base-url http://127.0.0.1:8080/v1 --no-history
```

Use the model name exposed by your server. Neura does not start or download it.
This example explicitly selects local transport and needs no subscription login.

For ChatGPT subscription testing, first verify the home DACL as described in
[authentication](docs/CODEX_AUTH.md). Then start an interactive terminal:

```powershell
neura --cwd $workspace --provider openai-codex --model gpt-5.5 --no-history
```

Enter `/login` only when you intend to authorize Neura, and open the displayed
URL yourself. Real login, reduced-scope acceptance and model entitlement remain
manual gates. A ChatGPT subscription is not proof that this adapter or model is
available to your account. Do not share the authorization URL, callbacks, tokens
or credential files in an issue. `--no-history` disables conversation persistence.
It does not prevent credential or Learn-artifact writes.

OpenAI API and Anthropic API are separate, explicitly selected providers using
`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`. Those calls can incur API charges. A
ChatGPT subscription does not pay for them. Subscription failure never falls back
to API billing. Don't put keys in prompts or command arguments.

### Work and Learn checks after provider access is confirmed

In Work, ask: `Read sample.txt and report its contents without changing it.`
Then ask: `Create result.txt containing only beta.` Inspect the actual file.
For a command test, ask to run `printf sandbox-ok` and inspect the proposed
command before typing `yes`. First reject a command to check denial. A missing
WSL/bubblewrap runtime must refuse execution, not fall back to the host.

Switch to Learn and try a lesson using only synthetic material:

```text
/mode learn
Teach one concept about database joins. Show a diagram and a short example, then give me one exercise.
/learn answer <your actual answer>
/learn hint
/learn save
/learn saved
/learn resume <progress-filename>
```

For document import, add a synthetic PDF or PPTX to this workspace, then ask to
learn from that relative path. Open the returned HTML board. Its copy controls
send revision-bound commands back through the terminal. There is **no automatic browser synchronization**. Saved excerpts are historical until sources are
reimported. Correct practice is not proof of mastery.

`/help`, `/mode work|learn`, `/model`, `/new`, `/sessions` and `/resume <id>`
control the harness. Ctrl+C cancels a running turn. `/quit` exits. Headless
`--prompt` cannot approve commands. History is workspace-scoped under `~/.neura`
or explicit `NEURA_HOME`. Crash locks fail closed. Learn artifacts use the
workspace's owned `.neura-learning` store.

## Rollback and limits

Exit Neura before changing its launcher or source. A source-linked install can
be bypassed by invoking an explicitly chosen checkout's `node src/cli.ts` with
`--cwd` pointing to the test workspace.
If installation created a legacy-launcher backup, restore only that known backup
after confirming the destination is still the installer-owned launcher. There is
no automatic rollback command. Do not reset a dirty checkout or delete private
homes, Pi profiles, vaults or recovery backups to undo a launcher change.

Plan, YOLO, Human Away, delegation, LSP/MCP, full proof/ship and the old cockpit
are not implemented in this slice. Legacy source and tests are porting evidence,
not active features. Managed Pi retirement is a separate, explicit operation.
It is not needed for these tests and must not run while Pi agents are active.

## Verify the source

```powershell
npm run verify
npm run test:browser:learn
node scripts/check-docs.mjs
git diff --check
```

Default `npm run verify` checks deterministic Work approval/current-authority
boundaries and unavailable-sandbox refusal without requiring a successful WSL
command. Sandbox argument, link and integrity contracts remain mandatory. Hosted
PR CI does not establish real Work sandbox execution.

On a configured native Windows host with WSL2, a selected/default distro and
working bubblewrap, run the separate acceptance check:

```powershell
npm run test:v1:work-sandbox
```

This checks an approved Work command's code 0 and exact workspace file content.
It fails, rather than skips, when the required host prerequisites are missing.
The release workflow requires it in addition to default verification, after the
unchanged license gate. A release host still needs reviewed sandbox provisioning.
The separate `npm run verify:sandbox` primitive isolation replay is not replaced
by this Work acceptance check.

Automated checks use synthetic models, materials and stores. They do not perform
real login or establish provider entitlement. See [dated evidence and remaining
gates](docs/MASTRA_V1.md#evidence-and-remaining-gates). `verify:release` remains
blocked by dependency licensing and distribution review.

## CI and release automation

PR and merge-queue checks retain the required `harness` and `portable-proof`
names. Windows runs the full development suite, secret-scan regressions, registry
signature audits and Learn browser checks. Ubuntu runs the portable contracts.
`Required CI` rejects failed prerequisites, and CodeQL scans JavaScript/TypeScript.
Both Windows workflows verify the downloaded Git identity and select that same
binary through the explicit executable setting and child-process PATH.

The daily dependency workflow checks both active dependency graphs and their
registry signatures. Mandatory workflow-contract tests reject weakened gates.
These are focused source contracts, not a general YAML validation service.

Tag-triggered release automation remains blocked by Mastra licensing review.
It cannot reach asset publication without the release gate and configured-host
Work acceptance. A production release host is not provisioned or approved by
these changes. No tag, release or deployment is part of this update.

Apache-2.0 applies to Neura source. Third-party packages retain their own terms.

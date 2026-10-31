# Mastra v1: Learn-first development slice

Owner direction, 2026-10-24: build the minimum usable harness, then make Learn the
first end-to-end mode. Do not wait for all sixteen migration issues to finish.
This changes implementation order, not the need for deterministic authorization,
privacy, dependency review or honest release gates.

Manual setup and disposable-workspace checks are in the
[project README](../README.md#manual-test-in-a-disposable-workspace).
Keep testing limited to synthetic, non-sensitive materials: local use alone
is not permission to process end-user, customer or business-operational data
under the unresolved Mastra EE scope. Source-linked launcher checks establish
checkout selection, not a sealed build, provider entitlement or release approval.
The development installer requires an ASCII-only checkout path and rejects
unsupported paths before prerequisite checks or launcher writes.

## Implemented source

| Surface | Implementation | Current limit |
|---|---|---|
| Actual agent loop | `src/runtime.ts`, real Mastra Agent, final schema validation, serialized effects, bounded steps, cancellation, learner-facing turn termination | Not durable effect recovery or autonomous shipping |
| Providers | `src/providers.ts`/`src/auth.ts`, separate ChatGPT subscription/local/OpenAI API/Anthropic API transports, native image parts, explicit login/logout | Synthetic subscription tests are not real-account entitlement or live protocol evidence; see auth status below |
| Terminal | `src/cli.ts`, Node readline, logo launch, Work/Learn, scratch-home startup, explicit commands, waiting status and optional provider reasoning summaries | No old Pi cockpit/editor/IME parity. Summaries may arrive only after completion, never hidden reasoning |
| Manual verification | `src/verification.ts`, reused PoW 0.2.0, Git snapshots and offline WSL sandbox, Work-only approval, session-local receipts and currency checks | Detector-only is never verified. Full proof is unavailable. No durable/signed receipt, original task-base or ignored-file coverage. Configured-host PoW acceptance remains blocked by missing trusted proof paths |
| Work | `src/work.ts`, reused canonical policy/read/sandbox services, original-byte hash binding with redacted delivery and refusal of redacted mutations, exact interactive command approval with fresh binding | No remote/protected actions, no headless approval or trusted full-proof PASS. Neura runtime writes are blocked even from nested/parent roots; commands on overlapping Neura checkouts require an external manual terminal. Existing workspace/same-user and descendant-cancellation limits remain |
| Learn | `src/learn.ts`, session-local service using existing Neura parsers, renderer, schemas, exercise/store/vault modules | Native Windows first-store creation, explicit snapshots, historical source restore, no automatic browser sync |
| History | `src/session.ts`, workspace-scoped CLI directories and `src/session-lock.ts` writer leases, fresh tool authority per turn | Crash locks fail closed; no automatic legacy import or durable reconciliation of uncertain effects |
| Launcher | `launcher/neura.cmd`, source-linked `install.ps1 -Development` | Local development/testing only; not a release or sealed runtime installer |
| Cleanup | `scripts/retire-pi-neura.ps1`, default read-only inventory; receipt/hash-matched reversible moves with `-Apply` | Refuses while Pi agents are active; no profile/global-Pi wipe, no private data removal |

The active lockfiles contain no Pi-named dependency; reachable local imports and
launcher are checked by `scripts/check-pi-free.mjs`. This is a package/import
identity check, not exhaustive embedded-code or license certification.

## Authentication status

ChatGPT subscription is the CLI default. Only an explicit interactive `/login`
starts the PKCE browser flow; `/logout` deletes Neura's local credential without
claiming remote revocation. Tokens, refreshes and locks live only in Neura's home.
See [the protocol, storage boundaries and synthetic evidence](CODEX_AUTH.md).
The owner reported working responses after the transport repair. Coverage of
reduced scopes, refresh/restart and model entitlement remains incomplete. Automated
checks do not establish live-account acceptance.
Before real credentials are used, inspect the actual Windows home DACL and any
existing credential-file DACL. Profile inheritance alone is not verification,
and the runtime does not independently enforce Windows DACL privacy.
Workspace/private-home paths must be disjoint, including ancestors, descendants and
not-yet-created homes below junctions. Pi profiles cannot be project workspaces.
`codex-auth.json` is reserved from public file reads, listings and mutations.

Local OpenAI-compatible models require an explicit loopback endpoint. API providers
require explicit API selection and their own environment variables. There is no
fallback from subscription access to API billing. A new installation never reads
Pi tokens or silently reuses Pi history.

## Learn acceptance

The direct service test exercises a real synthetic PDF import, citation validation,
board publication, actual learner-answer provenance, duplicate invented-attempt
refusal, hints, save, a fresh service, explicit historical resume, mandatory source
reimport, revision-bound board requests, cancellation and stale-tool denial. PPTX
import uses the same bounded worker as the legacy implementation. Dedicated existing
suites retain offline OCR, parser attacks, SQL bounds, storage races and vault integrity.

The model must see four dedicated tools: `learn_material`, `learn_lesson`,
`learn_exercise`, `learn_progress`. It may additionally use bounded public workspace
`read`/`ls`; generic writes, shell, Plan publication and integrations are unavailable.
Lessons and evaluated attempts end the turn. The CLI command path is actual user
input, not a second model-generated source of answers.

After every asynchronous step, the session/mode epoch is checked before publishing
new session state. A completed disk/vault write cannot be undone simply because a
later epoch check fails: a valid but unreferenced artifact/event may remain. This is
not an atomic multi-store transaction or zero-side-effect cancellation guarantee.

## Evidence and remaining gates

### Work verification split: 2026-10-25

Default `npm run verify` retains mandatory sandbox argument/link/integrity
contracts, but no longer assumes successful Work execution on an unconfigured
host. Four mandatory Work callback tests cover denied approval, stale generation,
approval-time cancellation and unavailable sandbox. Builtin mocks are confined to
isolated test processes. They synthesize both absent `wsl.exe` and a present
executable with unavailable distro/bubblewrap, reject unexpected process calls,
and assert no payload files or host-shell fallback.

After the test/command/workflow changes froze, one full `npm run verify` passed:
exit 0, strict types, 208 locked entries / 29 reachable local modules, 13/13
suites, 45 Node tests and seven current documents. The Learn suite now has ten
tests, including four deterministic Work boundaries. Only this evidence paragraph
was added after that full run, followed by the document and whitespace checks.

The focused command `node --test --test-name-pattern='Work execution boundary'
tests/v1-learn.test.ts` passed four tests, exit 0. The separate configured-host
command `npm run test:v1:work-sandbox` passed one test, exit 0, on this laptop's
existing native Windows/WSL setup. It preserves the real approved command,
code-0 and exact file-content assertions. It has no skip-if-unavailable: explicit
invocation without its prerequisites fails. No installation or real provider
request was made.

PR CI verifies the default contracts, not successful WSL Work execution. The
blocked release workflow additionally requires the configured-host command after
the unchanged license gate. Release-host sandbox provisioning still needs review.
The separate `npm run verify:sandbox` primitive isolation replay was not rerun and
is not replaced by the Work callback acceptance. Earlier test counts below retain
their original scope and do not establish the current split's coverage.

### Earlier code-review checkpoint: 2026-10-25

On native Windows Node 24.19.0, the code-review lane ran `npm run verify` once:
exit 0, strict types, 208 locked entries / 29 reachable local modules, 13/13
suites, 42 Node tests and seven current documents. This includes two new
regressions: session paths reject linked canonical ancestors before directory
or history creation, and the installer refuses non-ASCII checkout paths without
creating a launcher directory. Normal session creation/save/resume and isolated
installer preservation controls also pass.

An unused test import was removed afterward. The affected runtime suite was
rerun (`node --test tests/v1-runtime.test.ts`): 15 tests, exit 0.
`npm run typecheck:v1` also exited 0 after that cleanup. A second full runner
was not run. The parent independently inspected the four-file code delta and
reported no blocker within that scope. Final combined review and new-head CI
remain required. These are source checks, not real-account or distribution
approval. The expected `npm run verify:release` denial exited 1.

The setup lane then repeated the actual installed `neura.cmd --help`,
`neura.cmd --check` and `powershell -NoProfile -File .\install.ps1 -Check`:
exit 0 for each. Command discovery selected the expected source-linked launcher.
A disposable workspace and synthetic `NEURA_HOME` were used. No home was created,
no source or launcher drift occurred during those checks, and no reinstall was
needed. These checks establish launcher/source selection, not WSL execution,
credential-file privacy or a usable provider/model session.

Fresh standalone browser, full WSL replay and dependency audits were not repeated
by those lanes. The following earlier results retain their original date and do
not become new 2026-10-25 evidence.

### Earlier migration checkpoint: 2026-10-24

Combined source verification on native Windows Node 24.19.0:

| Command | Result |
|---|---|
| `npm run typecheck:v1` | PASS, exit 0, strict active-source/test types |
| `node scripts/check-pi-free.mjs` | PASS, exit 0, 208 lock entries and 29 reachable local modules; package/import identity only |
| `node scripts/check-docs.mjs` / `git diff --check` | PASS, exit 0 for each; seven current documents and whitespace |
| `node scripts/verify-harness.mjs` | PASS, exit 0, 13/13 suites: 40 Node tests plus retained material/workshop/storage/vault/sandbox/process and fresh-query workspace traversal contracts |
| `npm run test:browser:learn` | PASS, exit 0, desktop/mobile, keyboard, axe, CSP, no network, diagrams, grading and terminal handoff; desktop/mobile screenshots visually inspected |
| `node scripts/verify-sandbox.mjs` | PASS, exit 0, actual WSL replay: workspace write allowed; host homes/env, network, system writes and junction escapes blocked |
| `npm audit --audit-level=low` / `npm audit --prefix agent/neura --audit-level=low` | PASS, exit 0 for each, zero vulnerabilities |
| `npm audit signatures` / `npm audit signatures --prefix agent/neura` | PASS, exit 0 for each; 156/21 signatures and 42/3 attestations verified |
| `powershell -NoProfile -File .\install.ps1 -Development` | PASS, exit 0, actual receipt-owned PC launcher switched with a backup; no Pi/private-state removal |
| `powershell -NoProfile -File .\install.ps1 -Check` | PASS, exit 0, actual source-linked launcher matches; not sealed-runtime attestation |
| `& (Join-Path $HOME ".local\bin\neura.cmd") --check` | PASS, exit 0, actual installed launcher reaches Mastra 1.79.0 on Windows Node 24.19.0 |

Materials include real synthetic PDF/PPTX/scanned-PDF OCR, 43 parser assertions;
storage and vault suites retain 61 and 38 checks. CLI tests exercise actual Mastra
and loopback transport, a lesson stop, six-tool Learn allowlist, workspace-scoped
history, unavailable modes, headless-login denial and isolated local logout. No
real provider/token request or personal learner document was used by these tests.

The independent Pi boundary reviewer reproduced the original redaction/hash
collision and verified its fix: only original-byte digests are used, hidden values
are not returned, and redacted files cannot be edited or rewritten. Self-runtime
protection was also verified from the application root, its descendants and parent
workspaces, without asking for approval. The review reported no remaining blocking
finding within the stated development scope. A final six-file credential-home
review then reproduced a missing-home junction overlap; the shared guard was
fixed to resolve the nearest existing ancestor (rejecting direct linked ancestors).
The reviewer independently reran the original CLI probe and positive/negative
focused tests: both direct/deeper junction overlaps fail before home/history
creation; a separate missing home remains allowed. No remaining blocker was
reported in that bounded delta. This is not an exhaustive source/ACL audit.
Separate synthetic retirement tests verify receipt-only moves, preserved changed/private files, recovery journaling,
active-process refusal, linked-root refusal and receipt traversal rejection.

Historical Pi aggregate failure after Pi package removal was not relabeled as a
Mastra pass. Its runner/checker are retained as `scripts/verify-legacy-harness.mjs`
and `scripts/check-legacy-docs.mjs`. The active runner rejects unknown legacy suite
names instead of silently skipping them.

These checks do not certify full original-product parity, production readiness,
real login/model entitlement, live uncertain-effect recovery or redistribution.
The release check remains blocked by dependency license/distribution review.
No commit, tag, push, merge or publication occurred.

## Legacy source and machine state

The old Pi installer is archived at `legacy/pi/install.ps1` for historical reference;
its old path assumptions make it unsuitable as a new installer. Unported extensions,
configuration and regression fixtures are retained as porting evidence, not loaded
by Mastra. Original migration worktrees and user-authored reference documents stay
intact. Deleting source history would not make a runtime Pi-free.

The PC had active Pi agent processes during migration, so retirement was initially
blocked. After the owned worker finished, the owner explicitly approved exiting the
other completed Pi agent and applying retirement. That agent exited via its supported
`/quit`; its pane was left open and no other project agents were terminated.

`powershell -NoProfile -File .\scripts\retire-pi-neura.ps1 -Apply` exited 0:
904 receipt/hash-matched legacy Neura files moved reversibly, two modified/private
entries preserved, zero active Pi processes at application. The recovery backup
contains `retirement.jsonl` and `legacy-install-receipt.json`. Its exact location
and identifier are machine-local, not published here. Standalone Pi, settings,
credentials, memory, approvals, history, vaults and unmatched files were preserved.
No global package was uninstalled. Post-retirement verification exited 0: all 904
journaled sources are absent, all 904 backup SHA-256 hashes match, and the recovery
receipt exists. A fresh read-only inventory reports zero matched files, two
preserved entries and zero active Pi processes. Both `install.ps1 -Check` and the
installed `neura.cmd --check` pass after retirement. The focused command
`node --test --test-reporter=spec tests/v1-learn.test.ts tests/v1-cli.test.ts`
also passes afterward: nine tests, zero failures, exit 0.

The Mastra launcher remains active; this is managed Neura retirement, not erasure
of all Pi traces or private data.

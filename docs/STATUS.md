# Neura status

## Active source: Mastra v1 development migration (2026-10-24)

The owner authorized Pi-free implementation with a usable core and Learn first.
The active entry point is `src/cli.ts`, not the retained Pi extensions. Work and
Learn are the only exposed modes. Root dependencies, launcher and v1 verification
are being migrated together. Legacy provider/profile data is not imported.

**Development/testing only. Not a release, full feature parity or production-ready.**
Mastra's bundled EE license scope and distribution approval remain unresolved;
`verify:release` must stay blocked. Existing metadata stays `2.6.0-rc.1`; no new
release or semantic-version decision is implied. Latest published remains `2.5.1`.

Current implementation, exact test evidence and operational limitations are in
[Mastra v1](MASTRA_V1.md), [dependency review](MASTRA_V1_DEPENDENCIES.md), and
[subscription authentication](CODEX_AUTH.md). Subscription login/refresh/transport
have synthetic tests; no real-account login or provider entitlement is claimed.
The original Pi audit below is historical baseline evidence, not current Mastra
verification or permission to install/downgrade Pi. Original hardening issues stay
open; a framework change does not close them. Human Away is unavailable in v1.
Baseline coverage and owners are tracked in the [parity matrix](PARITY_MATRIX.md) (#114); it is not a parity or readiness claim.
On 2026-11-05 the owner accepted Mastra EE terms for local development/testing only. The [M1 closure review](MASTRA_V1_DEPENDENCIES.md#m1-package-closure-review-2026-11-05) (#115) now gates pins, install scripts and licenses.

## Learn hardening (2026-11-07)

The active Learn service now bounds vault topic metadata without shortening lesson
titles or changing vault validation. Synthetic Windows regressions cover title
bounds, configured-vault concept/practice events without raw answers, fresh-process
explicit save/resume, historical citations until reimport, and delayed board/vault
operations across session changes, mode changes and cancellation. Stale vault
failures no longer emit warnings into a later session. Completed artifacts/events
may remain; no autosave or browser synchronization was added. See
[Learn acceptance](MASTRA_V1.md#learn-acceptance). #123 remains open.

## Current maintenance checkpoint (2026-10-27)

The owner reported a completed subscription sign-in followed by HTTP 400 on the
first model request. The adapter now classifies recognized backend rejections
without exposing raw responses or credentials. The server-side cause and usable
subscription access remain unverified. [#118](https://github.com/Rajveerx11/neura/issues/118)
stays open. The owner's next retry reported the selected model as unavailable.
The CLI now opens a numbered subscription picker with bare `/model` and discovers
a provider-advertised default instead of assuming `gpt-5.5`. Tool-call starts and
outcomes are visible without raw payloads. Real account catalog/inference access
still needs manual verification. See [model selection](CODEX_AUTH.md#subscription-model-discovery-and-selection)
and [safe diagnostics](CODEX_AUTH.md#safe-rejection-diagnostics).

A later owner retry selected a catalog model but failed with
`Codex subscription requires an event stream`. The transport now accepts bounded,
explicitly completed JSON responses as well as SSE. Synthetic real-CLI text/tool
regressions reproduce the old rejection and exercise the repair. Incomplete or
malformed responses still fail, with no provider substitution or task replay.
The actual backend response was not inspected. Live inference remains unverified
and subject to the credential DACL gate in [subscription authentication](CODEX_AUTH.md).

The owner's next retry still reported `unsupported response format`. After reading
OpenAI's official authentication/streaming docs and inspecting its Codex transport,
Neura removed the extra MIME-only rejection for successful Responses SSE. Generic
or missing MIME must still decode to a completed snapshot; HTML and partial streams
fail. Failures now include bounded HTTP/MIME facts without raw bodies or headers.
Buffered SSE has a five-minute idle limit with cancellation. See the
[official transport evidence](CODEX_AUTH.md#official-openai-transport-contract-and-mime-handling).
These source and synthetic checks do not establish live subscription access.

The owner subsequently reported working responses. This is manual acceptance of
the repaired path, not an independent entitlement/refresh/restart audit. The
terminal now has a waiting status and optional provider reasoning summaries.
OpenAI's hidden reasoning and encrypted metadata remain unavailable. See
[reasoning visibility](CODEX_AUTH.md#provider-reasoning-summaries).

The first verification slice adds manual `/verify quick|full|status` in Work.
Its detector receipts bind to candidate fingerprints and stay in session memory. It reuses PoW and the existing
isolated runner, not a new verification engine. Every receipt retains
`verified:false`. PoW 0.2.0 still blocks full trusted evidence. Durable receipts,
original-task-base binding, ignored-file coverage and delivery enforcement remain
open under #91/#28. A read-only local readiness probe reported that trusted WSL
proof paths are not configured. No proof tooling was installed or run on the host.
The offline PoW execution path remains unverified on this machine. Synthetic
bridge checks are not real-artifact acceptance. See the [manual command](../README.md#manual-verification-first-integration-slice).

Work now runs an engineering review workflow by default (`/workflow on|off`).
After a Work turn changes the Git workspace, path-based risk routing skips
docs-only changes; otherwise one fresh reviewer with code-enforced read-only
tools reviews the candidate diff. Receipts bind to the candidate fingerprint and
go `stale` on any later edit. The controller, not the model, marks must-fix
findings (blocker, or major with non-low confidence). The builder fixes them
automatically for up to 3 review rounds. Every run ends `READY FOR YOUR APPROVAL`,
`BLOCKED` or `Review skipped`, and never commits, pushes or merges. The reviewer
defaults to the builder model and is labelled same-family. Set a different
provider with `--reviewer-provider/--reviewer-model` or `/reviewer` for
cross-family independence. Receipts are session-local. Tests use fake and
mock-model reviewers. Live same-family reviewer runs are recorded in
[Mastra v1](MASTRA_V1.md#real-project-work-2026-11-06).

Cleanup distinguishes obsolete implementation work from unmet requirements.
The stock-Pi three-configuration benchmark (#61) and the retired Pi cockpit/widget
render optimization (#60) no longer describe the active readline application.
Those implementation-specific tasks are closed as not planned, not completed.
Terminal replacement work remains #124. Active-runtime evaluation remains #30.
Keep original hardening and migration blockers open, including installation and
recovery work. Historical source, plans and verification records are retained
deliberately. Unreachable by the active app does not mean safe to delete. No private profiles,
credentials, history, vaults, user drafts or other worktrees are cleanup targets.

## Real-project Work (2026-11-06)

Owner-approved plan: [plans/neura-real-project-work](../plans/neura-real-project-work/plan.mdx).
This is Milestone 1. Work builder turns now get 60 model steps; Learn and reviewer
turns keep 8. A turn that runs out stops honestly: it prints no raw tool output,
skips review and keeps its starting baseline, so `continue` reviews the whole task.
Work and the reviewer gain `grep` and `find`. `write` creates missing folders.
A small dotfile allowlist is writable, including `.env.example`, which is no longer
treated as secret. `.env`, `.npmrc`, `.git`, `.husky` and `.vscode` stay denied.
Every `.github/` write needs typed approval and must fit in the prompt. Root `AGENTS.md` and
`CLAUDE.md` load as bounded, untrusted user context, never system instructions or
saved history. They cannot widen policy. A tool's own
refusal now reaches the model instead of a generic failure.

**Security fix:** a sandboxed `npm test` could plant `.git/hooks/pre-commit`, which
host Git would run outside the sandbox. Commands that policy routes `allow` now run
without a prompt when `.git` exists, and they run model-written code, so the sandbox
holds the boundary. `.git`, `.github`, `.husky` and `.vscode` are read-only at any
depth. Any such path a command creates is removed afterward and the command reports
failure. Cleanup does not depend on the discovery scan limit. If any subtree cannot
be checked or cleaned, execution reports failure and requires manual inspection
before running host tools. Secret-named files are empty or unreadable, including inside host-run and
dependency folders. Regular files with multiple hardlinks are refused before
execution. Symlinks are allowed only inside `node_modules` and `.venv`, except
host-run paths, which must not be links. Cleanup traverses newly created secret
folders, while preserving directories that were masked before the command. Chained and unclassified commands
still ask. Common dependency installs are refused at once with the exact manual
command. Commands refuse `.git` files at any depth: linked worktrees and separate
Git directories need an external manual terminal until their targets can be protected.

Commands can still read Git-ignored files without a secret name. Project code a
command changes still runs when you run it on the host, so review the diff.

Limits remain: no context compaction, no local Git commit from Neura, and any path
component named `memory`, `sessions`, `private` or `secrets` stays unreadable, which
can block real projects with such folders. See the evidence line in
[Mastra v1](MASTRA_V1.md#real-project-work-2026-11-06).

CI also runs Work-tool, reviewer and workflow regressions in the required Linux
`portable-proof` job. The Windows harness remains required. Release licensing
checks and configured-host acceptance remain separate gates.

## Branding and dependency grouping (2026-11-04)

The owner-approved context-into-action mark replaces the old block wordmark.
`src/brand.ts` holds a static ten-line half-block rendering. Startup loads no
image, font or new dependency. `--ascii`, `TERM=dumb` and terminals too narrow
for the mark print `>_ neura`. Interactive launch prints only the logo, then
status and the prompt; headless, `--help` and `--check` print no artwork. Assets and guide are in
[assets/brand](../assets/brand/README.txt); the historical owner artwork is kept.
Synthetic CLI tests cover widths 1–160, ASCII, dumb-terminal and narrow launch with
zero model requests. Trademark clearance and redistribution terms for the new
artwork are not yet documented, so this is not a release clearance.

Dependabot now groups `@mastra/*` with `@ai-sdk/*` (`model-stack`). The
unused Pi group was removed because the active root graph is Pi-free.

## Terminal UI integration (2026-11-04)

The terminal redesign built in a Cloudroom worktree on 2026-11-02 is now on
`main`. It was restored from the safety snapshot taken before that worktree was
removed. `src/terminal-ui.ts` holds pure, width-aware presentation. It covers
prompt-adjacent status, `/status`, Mastra-reported last-turn token usage, grouped
help, explicit approval and cancellation states, and copper color that
`NO_COLOR`/`TERM=dumb` disable. Context capacity stays unknown, so no percentage
is shown. Workspaces without a Git baseline get a once-per-session
`Review unavailable` notice only after a turn that may have changed files.
Details and limits are in
[terminal UX](TERMINAL_UX.md). Synthetic tests only: no new real-account or
live-provider evidence is claimed.

A follow-up quieted the chat transcript. Status prints once at launch and chat
turns print only the answer: model, message count and tokens live in `/status`.
The waiting line is erased when
output starts. Each tool call takes one line, and only failed, blocked or
cancelled outcomes add another. `[answer]` appears only after a reasoning
summary. A chat turn that changed nothing prints no review line, and bare
`exit`/`quit` close Neura.

## Historical Pi candidate baseline

Last documentation audit: 2026-10-20

Current candidate: [`2.6.0-rc.1`](releases/v2.6.0-rc.1.md). Latest published
release remains `2.5.1` until the candidate passes release gates and is published.
The candidate includes Work, modular verification, Learn Mode, the command
launcher, shared capability/policy/process contracts, exact Pi `1.3.0`
compatibility, reproducible opt-in guidance, and Plan confidentiality hardening.
No current live-install match is claimed. Node: `24.15+` (CI `24.16.0`).

Standing requirement (2026-10-06): Neura must work with the latest stable Pi after
every upstream update. npm's latest stable Pi was checked as `1.3.0` on 2026-10-19;
fresh dependency-PR CI rejected the older `1.2.0` target. This coordinated source
candidate advances the exact pins, runtime identity, and immutable guidance
`1.0.3` with matching compatibility metadata. Existing real-loader/session and
Plan confidentiality regressions remain required. Historical review/CI does not certify an integrated candidate;
independent review and required new-head CI must be evaluated separately.
Version agreement alone is not full compatibility or a live-install guarantee;
the owner's device/live state was not inspected. Update Neura and its exact pins
rather than downgrade Pi or bypass runtime checks. Follow the
[Pi compatibility policy](DEPENDENCIES.md#pi-compatibility-policy) and
[installer readiness](INSTALLER_READINESS.md).

Live installation: a local sync was performed on 2026-09-15, then rolled back
for touched live files at the owner's request so repository changes remain
source-only. No current live-match claim is made. Older working checkouts and
live installations can differ.

## Release decision

Release channel: experimental

**Public-release candidate. Neura is not production-ready.**

This public repository includes Apache-2.0, community policies, private npm
package metadata, pinned CI, CodeQL, dependency updates, and guarded draft-
prerelease automation. Publication of source does not imply production
readiness. Historical `v2.5.1` release
remains usable for its documented personal, single-user scope.
Production-readiness audit still has blockers in unattended execution and
installation reproducibility. Executable dependency trust improvements merged
under #22 do not close the remaining release and production gates. Human Away
remains preview-only.

The canonical hardening backlog is
[GitHub issue #31](https://github.com/Rajveerx11/neura/issues/31). Detailed
release gates and issue ownership live in
[PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).

## Current evidence

| Area | State | Evidence or blocker |
|---|---|---|
| Public source | Available; release blocked | The repository is public, GitHub recognizes Apache-2.0, the owner-supplied logo has documented redistribution terms, and a complete-history secret scan passed on 2026-09-15. Final content/default review and clean-profile install evidence remain release blockers. See [OPEN_SOURCE.md](OPEN_SOURCE.md). |
| Pi 1.3 base | Reviewed and CI-passing; integrated RC still requires validation | PR #109 head `2e5b678` passed required [CI run 39380070015](https://github.com/Rajveerx11/neura/actions/runs/39380070015) and merged as `0d91d0e`. On 2026-10-20 all 18 local harness suites, both browser suites, typecheck, 61 Herdr checks, 11 release checks, docs and latest-target checks passed using the documented Windows Git cmd layout. Independent review covered all 16 files; CodeRabbit completed with zero findings. Both graphs reported zero vulnerabilities and verified signatures/attestations (134/21 signatures, 39/3 attestations). This evidence does not certify the combined RC/dependency candidate; its own independent review, CodeRabbit and new-head CI remain required. LSP is unavailable. No live install, publication or production readiness is claimed. |
| Historical Pi 1.1 evidence | Previous source target; not Pi 1.3 candidate certification | On 2026-10-08 configured typecheck, all 18 isolated harness suites, 11 release checks and 35-file docs validation passed, including focused unit, proof, integration, UI and synthetic installer checks. Actual agent-pipeline tests deny activated codemode/tool-search tools in four restricted modes before/after reload, with YOLO/stock-Pi positives; nested duration linkage and normal/aborted settlement are exercised through a local synthetic stream. Native MCP HTTP/stdio/override/replacement-failure denial and stock native-connect controls remain. Aborted settlement starts no automatic quick proof. Synthetic Plan/Learn Edge checks passed; Plan needed environment-only cleanup ownership transfer after two failed temporary-profile cleanup commands. LSP is unavailable. No live installation/drift, supported POSIX rerun, exhaustive dependency provenance or full original-issue acceptance is claimed. |
| Historical Pi evidence | Pi 1.0.4 reviewed 2026-10-06; not current-candidate evidence | On 2026-10-06 the managed PR88 integration worktree passed configured typecheck, all 18 harness suites, docs, release tests, audits/signatures, and latest-Pi discovery at `1.0.4`. Real-loader/session tests cover enforced native MCP disable, override/reload/load-failure denial, nested deferred policy, and YOLO/stock-Pi positive controls. Independent review found no actionable issues in the 36-file scoped candidate. CodeRabbit completed with two unverified suggestions, independently assessed as non-actionable under the supported Git format and latest-Pi policy; no clean-CodeRabbit claim is made. Required remote CI is tracked on PR #88; local review does not attest it. No live installation or drift check was performed; no live-match claim is made. |
| Historical dependency graphs | Previous graph audited 2026-10-08 | The historical Windows-resolved Pi 1.1.0 root and unchanged Learn graphs report zero known vulnerabilities, 137/21 verified registry signatures and 42/3 attestations. Eight coupled Earendil packages advance; external versions/integrities stay unchanged, with two identical lock duplicates removed. Published lifecycle review and scripts-disabled private installation do not establish exhaustive native/WASM, built-source or dependency-trust attestation. See [dependency policy](DEPENDENCIES.md) and [Learn review](LEARN_DEPENDENCIES.md). |
| Proof delivery gate | Blocked; fail-closed safety slice in source | Pinned PoW 0.2.0 legacy full PASS is unavailable even with successful test flags. Quick PASS is detector-only and never engineering COMPLETE. Trusted suite policy, reviewed release evidence, and complete candidate binding remain [#91](https://github.com/Rajveerx11/neura/issues/91); no full verified PASS is currently available. |
| Core harness | Ready for covered behavior | Local verification on 2026-09-15 passed typecheck, docs, sandbox replay, Learn/Plan browser checks, and 18 isolated suites loading 19 extensions. CI passed on the public-repository hardening commit. |
| Default mode | Implemented in RC source | Work is default; execution uses network-disabled WSL2 bubblewrap, with no host fallback. [#23](https://github.com/Rajveerx11/neura/issues/23) is closed. |
| Learn Mode | Implemented in RC source | Practical lessons, diagrams, PDF/PPTX/OCR, bounded SQL, citations, explicit save/resume, and machine-local opt-in automatic Obsidian knowledge capture. The vault writer is application-controlled preview behavior; no live install or real-vault write is claimed. First workspace-store creation requires native Windows. Parser process limits are not OS isolation. See [LEARN_MODE.md](LEARN_MODE.md). |
| Human Away | Preview / blocked | Writable live-workspace mounting and repository-script indirection are unsafe for unattended production. Track [#24](https://github.com/Rajveerx11/neura/issues/24). |
| Automatic execution | Implemented in RC source | Work and YOLO proof share the network-disabled sandbox, hash-verified read-only uv/CPython/wheels, a fresh local cache, and no host fallback. Automatic Git uses pinned identity and disables hooks, filters, text conversion, external diff, prompts, and fs monitors; checkpoints copy raw bytes with rollback-safe restoration. Default MCP configuration has no local command, and health refuses workspace executables. `/ship` only verifies; it does not publish Git changes. Delivery evidence remains [#22](https://github.com/Rajveerx11/neura/issues/22). |
| Installation | Blocked; first readiness slice in source | Latest-Pi target checking, shared fail-closed prerequisite validation, no-downgrade guidance, and checksummed source ZIP packaging are prepared. Existing managed-file recovery remains; automatic prerequisite/WSL bootstrap, artifact delivery, cross-component recovery, and clean-host rehearsal are not complete. See [installer readiness](INSTALLER_READINESS.md). Activation across Pi, settings, launcher, and Terminal is not atomic; full [#21](https://github.com/Rajveerx11/neura/issues/21) remains open. |
| Credential incident | Closed | Owner confirmed revocation and replacement on 2026-09-12; complete-history scanning and negative regressions passed. See [#36](https://github.com/Rajveerx11/neura/issues/36) and [SECURITY_INCIDENTS.md](SECURITY_INCIDENTS.md). |
| Plan confidentiality | Source-only hardening | SDK-backed Plan wrappers authorize each concrete file before delivery, including tracked/global ignores and canonical link containment; historical Git content is denied and final context is redacted. Real-loader/session regressions cover private/search/history/link/race boundaries and native/plain-Pi controls. This is not a release, live-install, or OS-isolation guarantee. See [Plan confidentiality](PLAN_CONFIDENTIALITY.md) and [#35](https://github.com/Rajveerx11/neura/issues/35). |
| Approvals | Partially hardened | Cross-process locking, flushed appends, bounded Windows contention retries, and corruption/crash rejection are covered. Automatic recovery, authenticated tamper evidence, and stronger remote binding remain [#33](https://github.com/Rajveerx11/neura/issues/33). |
| Integrations and memory | Major gap | Public defaults no longer include a concrete Composio route, but October, MCP, Gmail, memory, redaction, and credential scoping still need work. Track [#29](https://github.com/Rajveerx11/neura/issues/29) and [#34](https://github.com/Rajveerx11/neura/issues/34). |
| Skills | Source-only supported guidance slice | One repository-owned `neura-verification` guidance skill is versioned, hashed, exact-Pi-compatible, and disabled by default. Installer/runtime validation and real Pi loader smoke tests cover its opt-in profile; read-only doctor and health's structured capability data carry exact manifest validation without personal-directory scanning; the compact health widget summarizes readiness, not the exact skill digest. Permissions restrict, never grant. External skills remain unsupported and no live/release attestation is made. See [skills contract](SKILLS.md) and [#38](https://github.com/Rajveerx11/neura/issues/38). |
| Type and test safety | Tests improved; strict typing open | Hermetic suites, seeded fuzzing, races, crash rejection, and content-bound receipts shipped; [#27](https://github.com/Rajveerx11/neura/issues/27) is closed. Configured typecheck passes; strict migration remains [#26](https://github.com/Rajveerx11/neura/issues/26). TypeScript LSP was unavailable on 2026-10-06 (`typescript-language-server` missing); no clean LSP result is claimed. |
| CI and releases | Guarded experimental path | Windows `harness`, Ubuntu `portable-proof`, dependency review, aggregate CI, and CodeQL use explicit runners and immutable GitHub-owned action pins. Tag automation publishes no npm package and can create only a draft prerelease after release gates; stable tags are blocked while this status says not production-ready. |
| UX and accessibility | Owner-supplied logo and image-backed launch implemented; wider surfaces covered | Windows Terminal owns the local logo artwork and Pi owns a centred functional launch editor with a logo-only fallback. Terminal widths are regression-tested. Plan and Learn real-Edge browser checks were repeated in this isolated Pi update with synthetic homes/profiles. These checks do not attest a clean-host install or live UI match. Track [#53](https://github.com/Rajveerx11/neura/issues/53) and [#54](https://github.com/Rajveerx11/neura/issues/54). |
| Health | Implemented in RC source | Core readiness is separate from optional capabilities. Bounded MCP/provider probes report explicit states, redacted errors, runtime identity, and remediation. Track delivery in [#39](https://github.com/Rajveerx11/neura/issues/39). |
| Evaluations and operations | Major gap | Privacy-preserving evaluation and observability remain open. Track [#30](https://github.com/Rajveerx11/neura/issues/30). |

## GitHub repository controls

The current repository settings reported for this infrastructure update are:

- `main` protection is strict/up-to-date and requires `harness` and
  `portable-proof`; it also requires one approval, code-owner review, dismissal
  of stale reviews, conversation resolution, linear history, and blocks force
  pushes and branch deletion.
- Administrator enforcement is off. The sole current administrator,
  `Rajveerx11`, can therefore bypass protection; no other bypass actor is
  reported.
- Actions token defaults are read-only and Actions cannot approve pull requests.
  Actions are limited to GitHub-owned actions pinned by full commit SHA.
- Private vulnerability reporting, Dependabot security updates, secret scanning,
  and push protection are enabled.

These are configuration facts, not claims that GitHub settings or automated
checks establish runtime correctness or production readiness. Logo redistribution
is documented separately in `agent/neura/launch-artwork.md`.
The stable aggregate `Required CI` is additive: preserving the required job names
`harness` and `portable-proof` keeps current protection satisfiable.

## Production claim gate

Delivery reference: [PR #44](https://github.com/Rajveerx11/neura/pull/44), merged
2026-09-07. Final reviewed head `c66c88c` passed
[CI run 34101891018](https://github.com/Rajveerx11/neura/actions/runs/34101891018)
and received Greptile 5/5 with no actionable findings. Review and CI establish
covered source behavior, not a release or live-install guarantee.

Documentation refresh validation on 2026-09-07: all 17 harness suites and configured
TypeScript passed in an isolated checkout of `d3e77c6` with the updated docs.
Documentation/link and whitespace checks passed. Browser, dependency-audit, and
live-install evidence above remains the dated delivery evidence; those checks
were not repeated for this documentation-only update.

Neura may be called production-ready only when:

1. Every open P0 issue in the Production readiness milestone is closed.
2. Security-critical P1 acceptance criteria and negative tests pass.
3. Human Away remains disabled or preview-labelled until its separate field gates pass.
4. Clean install, upgrade, interruption, rollback, and live-manifest checks pass.
5. Strict typecheck, adversarial tests, dependency audit, signature audit,
   secret scan, documentation check, and CI all pass from a clean checkout.
6. No unresolved credential incident, unknown live extension, or source/live drift exists.
7. Release notes state supported scope, remaining limitations, migration, and rollback.

Passing tests prove only the behavior they cover. Dates, version bumps, or a
green basic harness do not override an unmet production gate.

## Preserved invariants

- Repository checkout remains source of truth; live harness is generated.
- Plain Pi stays stock unless `NEURA` is set.
- The image-backed launch remains local, optional, and bounded by a logo-only fallback.
- Plan remains read-only except controlled plan publication.
- Deterministic policy outranks model review.
- Human Away remains preview-labelled.
- No automatic Git shipping returns.
- Credentials, memory, approvals, sessions, and raw transcripts stay out of source.

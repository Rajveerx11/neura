# Neura status

Last documentation audit: 2026-10-06

Latest release: `2.5.1`. Current merged source: `a0205eb`, including Work,
modular verification, and Learn Mode; these changes are unreleased. This checkout
adds source-only installer readiness work targeting exact Pi `1.0.4`; that work
is not merged, released, or installed. Node: `24.15+` (CI `24.16.0`).

Standing requirement (2026-10-06): Neura must work with the latest stable Pi after
every upstream update. npm's latest stable Pi was checked as `1.0.4` on that date;
device-version evidence from the earlier handoff is not an isolated-worktree check. This checkout now targets `1.0.4` with real-loader
security regressions; version agreement alone is not full compatibility or a
live-install guarantee. Update Neura and its exact pins rather than downgrade Pi
or bypass runtime checks. Follow the
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
Production-readiness audit still has blockers in unattended execution,
executable dependency trust, and installation reproducibility. Human Away
remains preview-only.

The canonical hardening backlog is
[GitHub issue #31](https://github.com/Rajveerx11/neura/issues/31). Detailed
release gates and issue ownership live in
[PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).

## Current evidence

| Area | State | Evidence or blocker |
|---|---|---|
| Public source | Available; release blocked | The repository is public, GitHub recognizes Apache-2.0, the owner-supplied logo has documented redistribution terms, and a complete-history secret scan passed on 2026-09-15. Final content/default review and clean-profile install evidence remain release blockers. See [OPEN_SOURCE.md](OPEN_SOURCE.md). |
| Pi and live Neura | Pi 1.0.4 isolated source target; live state not checked | On 2026-10-06 the managed PR88 integration worktree passed configured typecheck, all 18 harness suites, docs, release tests, audits/signatures, and latest-Pi discovery at `1.0.4`. Real-loader/session tests cover enforced native MCP disable, override/reload/load-failure denial, nested deferred policy, and YOLO/stock-Pi positive controls. Independent review found no actionable issues in the 36-file scoped candidate. CodeRabbit completed with two unverified suggestions, independently assessed as non-actionable under the supported Git format and latest-Pi policy; no clean-CodeRabbit claim is made. Required remote CI is tracked on PR #88; local review does not attest it. No live installation or drift check was performed; no live-match claim is made. |
| Dependency graphs | Source graph audited 2026-10-06 | Root and Learn audits report zero known vulnerabilities; the Windows-resolved Pi 1.0.4 root graph reports 137 verified registry signatures and 42 attestations, Learn reports 21 signatures and 3 attestations. This is not a full dependency-trust or production-readiness attestation. See [dependency policy](DEPENDENCIES.md) and [Learn review](LEARN_DEPENDENCIES.md). |
| Proof delivery gate | Blocked; fail-closed safety slice in source | Pinned PoW 0.2.0 legacy full PASS is unavailable even with successful test flags. Quick PASS is detector-only and never engineering COMPLETE. Trusted suite policy, reviewed release evidence, and complete candidate binding remain [#91](https://github.com/Rajveerx11/neura/issues/91); no full verified PASS is currently available. |
| Core harness | Ready for covered behavior | Local verification on 2026-09-15 passed typecheck, docs, sandbox replay, Learn/Plan browser checks, and 18 isolated suites loading 19 extensions. CI passed on the public-repository hardening commit. |
| Default mode | Implemented, unreleased | Work is default; execution uses network-disabled WSL2 bubblewrap, with no host fallback. [#23](https://github.com/Rajveerx11/neura/issues/23) is closed. |
| Learn Mode | Implemented, unreleased | Practical lessons, diagrams, PDF/PPTX/OCR, bounded SQL, citations, explicit save/resume, and machine-local opt-in automatic Obsidian knowledge capture. The vault writer is application-controlled preview behavior; no live install or real-vault write is claimed. First workspace-store creation requires native Windows. Parser process limits are not OS isolation. See [LEARN_MODE.md](LEARN_MODE.md). |
| Human Away | Preview / blocked | Writable live-workspace mounting and repository-script indirection are unsafe for unattended production. Track [#24](https://github.com/Rajveerx11/neura/issues/24). |
| Automatic execution | Implemented in source; unreleased | Work and YOLO proof share the network-disabled sandbox, hash-verified read-only uv/CPython/wheels, a fresh local cache, and no host fallback. Automatic Git uses pinned identity and disables hooks, filters, text conversion, external diff, prompts, and fs monitors; checkpoints copy raw bytes with rollback-safe restoration. Default MCP configuration has no local command, and health refuses workspace executables. `/ship` only verifies; it does not publish Git changes. Delivery evidence remains [#22](https://github.com/Rajveerx11/neura/issues/22). |
| Installation | Blocked; first readiness slice in source | Latest-Pi target checking, shared fail-closed prerequisite validation, no-downgrade guidance, and checksummed source ZIP packaging are prepared. Existing managed-file recovery remains; automatic prerequisite/WSL bootstrap, artifact delivery, cross-component recovery, and clean-host rehearsal are not complete. See [installer readiness](INSTALLER_READINESS.md). Activation across Pi, settings, launcher, and Terminal is not atomic; full [#21](https://github.com/Rajveerx11/neura/issues/21) remains open. |
| Credential incident | Closed | Owner confirmed revocation and replacement on 2026-09-12; complete-history scanning and negative regressions passed. See [#36](https://github.com/Rajveerx11/neura/issues/36) and [SECURITY_INCIDENTS.md](SECURITY_INCIDENTS.md). |
| Plan confidentiality | Major gap | Broad searches can discover ignored or historical secrets. Track [#35](https://github.com/Rajveerx11/neura/issues/35). |
| Approvals | Partially hardened | Cross-process locking, flushed appends, bounded Windows contention retries, and corruption/crash rejection are covered. Automatic recovery, authenticated tamper evidence, and stronger remote binding remain [#33](https://github.com/Rajveerx11/neura/issues/33). |
| Integrations and memory | Major gap | Public defaults no longer include a concrete Composio route, but October, MCP, Gmail, memory, redaction, and credential scoping still need work. Track [#29](https://github.com/Rajveerx11/neura/issues/29) and [#34](https://github.com/Rajveerx11/neura/issues/34). |
| Skills | Source-only supported guidance slice | One repository-owned `neura-verification` guidance skill is versioned, hashed, exact-Pi-compatible, and disabled by default. Installer/runtime validation and real Pi loader smoke tests cover its opt-in profile; health and read-only doctor report exact manifest validation without personal-directory scanning. Permissions restrict, never grant. External skills remain unsupported and no live/release attestation is made. See [skills contract](SKILLS.md) and [#38](https://github.com/Rajveerx11/neura/issues/38). |
| Type and test safety | Tests improved; strict typing open | Hermetic suites, seeded fuzzing, races, crash rejection, and content-bound receipts shipped; [#27](https://github.com/Rajveerx11/neura/issues/27) is closed. Configured typecheck passes; strict migration remains [#26](https://github.com/Rajveerx11/neura/issues/26). TypeScript LSP was unavailable on 2026-10-06 (`typescript-language-server` missing); no clean LSP result is claimed. |
| CI and releases | Guarded experimental path | Windows `harness`, Ubuntu `portable-proof`, dependency review, aggregate CI, and CodeQL use explicit runners and immutable GitHub-owned action pins. Tag automation publishes no npm package and can create only a draft prerelease after release gates; stable tags are blocked while this status says not production-ready. |
| UX and accessibility | Owner-supplied logo and image-backed launch implemented; wider surfaces covered | Windows Terminal owns the local logo artwork and Pi owns a centred functional launch editor with a logo-only fallback. Terminal widths are regression-tested. Plan and Learn real-Edge browser checks were repeated in this isolated Pi update with synthetic homes/profiles. These checks do not attest a clean-host install or live UI match. Track [#53](https://github.com/Rajveerx11/neura/issues/53) and [#54](https://github.com/Rajveerx11/neura/issues/54). |
| Health | Implemented, unreleased | Core readiness is separate from optional capabilities. Bounded MCP/provider probes report explicit states, redacted errors, runtime identity, and remediation. Track delivery in [#39](https://github.com/Rajveerx11/neura/issues/39). |
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

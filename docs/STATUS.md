# Neura status

Last documentation audit: 2026-09-13

Latest release: `2.5.1`. Current merged source: `d3e77c6`, including Work,
modular verification, and Learn Mode; these changes are unreleased. Required Pi:
`0.84.4`; Node: `24.15+` (CI `24.16.0`).

Live installation: not refreshed by the Learn delivery or this documentation
audit. No new live-drift result is claimed. These docs describe merged source;
older working checkouts and live installations can differ.

## Release decision

**Public-release candidate. Neura is not production-ready.**

This revision includes Apache-2.0, community policies, and package metadata.
Repository visibility remains private pending the
[publication checklist](OPEN_SOURCE.md). Historical `v2.5.1` release
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
| Public release | Blocked | Public-default configuration cleanup, final history/content audit, GitHub settings, and launch-artwork redistribution rights remain. See [OPEN_SOURCE.md](OPEN_SOURCE.md). |
| Pi and live Neura | Source verified; live status unverified | Source and CI pin Pi `0.84.4`. A fresh owner-authorized install and drift check are separate from merge. |
| Dependency graphs | Verified at Learn delivery | Both lockfile graphs reported zero known vulnerabilities on 2026-09-07; Learn runtime verified 31 registry signatures and 13 attestations. See [dependency policy](DEPENDENCIES.md) and [Learn review](LEARN_DEPENDENCIES.md). |
| Core harness | Ready for covered behavior | PR #44 passed Windows harness and Linux portable CI, 17 isolated suites/17 extensions, typecheck, docs, and real Learn/Plan browser checks. This is not a fresh live WSL replay. |
| Default mode | Implemented, unreleased | Work is default; execution uses network-disabled WSL2 bubblewrap, with no host fallback. [#23](https://github.com/Rajveerx11/neura/issues/23) is closed. |
| Learn Mode | Implemented, unreleased | Practical lessons, diagrams, PDF/PPTX/OCR, bounded SQL, citations, and explicit save/resume. First store creation requires native Windows. Parser process limits are not OS isolation. See [LEARN_MODE.md](LEARN_MODE.md). |
| Human Away | Preview / blocked | Writable live-workspace mounting and repository-script indirection are unsafe for unattended production. Track [#24](https://github.com/Rajveerx11/neura/issues/24). |
| Automatic execution | Remaining dependency-trust gap | Work proof is isolated and YOLO proof uses the host. `/ship` only verifies; it does not publish Git changes. Executable provenance remains [#22](https://github.com/Rajveerx11/neura/issues/22). |
| Installation | Blocked | Atomic activation, rollback, file hashes, and unknown-extension detection are missing. Track [#21](https://github.com/Rajveerx11/neura/issues/21). |
| Credential incident | Closed | Owner confirmed revocation and replacement on 2026-09-12; complete-history scanning and negative regressions passed. See [#36](https://github.com/Rajveerx11/neura/issues/36) and [SECURITY_INCIDENTS.md](SECURITY_INCIDENTS.md). |
| Plan confidentiality | Major gap | Broad searches can discover ignored or historical secrets. Track [#35](https://github.com/Rajveerx11/neura/issues/35). |
| Approvals | Partially hardened | Cross-process locking, flushed appends, bounded Windows contention retries, and corruption/crash rejection are covered. Automatic recovery, authenticated tamper evidence, and stronger remote binding remain [#33](https://github.com/Rajveerx11/neura/issues/33). |
| Integrations and memory | Major gap | October, MCP, Gmail, memory, redaction, and credential scoping need work. Track [#29](https://github.com/Rajveerx11/neura/issues/29) and [#34](https://github.com/Rajveerx11/neura/issues/34). |
| Skills | Major gap | Enabled skills are not fully pinned, manifested, or isolated from personal state. Track [#38](https://github.com/Rajveerx11/neura/issues/38). |
| Type and test safety | Tests improved; strict typing open | Hermetic suites, seeded fuzzing, races, crash rejection, and content-bound receipts shipped; [#27](https://github.com/Rajveerx11/neura/issues/27) is closed. Configured typecheck passes; strict migration remains [#26](https://github.com/Rajveerx11/neura/issues/26). |
| UX and accessibility | Image-backed launch implemented; wider surfaces covered | Windows Terminal owns the local artwork and Pi owns a centred non-capturing launch overlay with a logo-only fallback. Terminal widths are regression-tested; bundled artwork rights remain a release blocker. Track [#53](https://github.com/Rajveerx11/neura/issues/53) and [#54](https://github.com/Rajveerx11/neura/issues/54). |
| Health | Implemented, unreleased | Core readiness is separate from optional capabilities. Bounded MCP/provider probes report explicit states, redacted errors, runtime identity, and remediation. Track delivery in [#39](https://github.com/Rajveerx11/neura/issues/39). |
| Evaluations and operations | Major gap | Privacy-preserving evaluation and observability remain open. Track [#30](https://github.com/Rajveerx11/neura/issues/30). |

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

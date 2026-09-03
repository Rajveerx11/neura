# Neura status

Last audited: 2026-09-03
Current source: `2.5.1` with an unreleased Pi `0.84.4` compatibility update
Live runtime: Pi `0.84.4`; live Neura files match source

## Release decision

**Private engineering use only. Neura is not production-ready.**

The historical `v2.5.1` release remains usable for its documented personal,
single-user scope. A fresh production-readiness audit found release blockers in
mode defaults, unattended execution, executable dependency trust, installation
reproducibility, and credential-incident closure. Human Away remains preview-only.

The canonical hardening backlog is
[GitHub issue #31](https://github.com/Rajveerx11/neura/issues/31). Detailed
release gates and issue ownership live in
[PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).

## Current evidence

| Area | State | Evidence or blocker |
|---|---|---|
| Pi and live Neura | Ready | Pi `0.84.4` is installed; the offline startup smoke test and `install.ps1 -Check` pass. |
| Dependency graph | Ready | Lockfile audit reports zero known vulnerabilities; 249 packages have verified registry signatures and 50 have attestations. |
| Core harness | Ready for covered behavior | Typecheck, 16-extension harness, documentation checks, and live WSL2 sandbox replay pass. |
| Default mode | Blocked | New sessions default to unsandboxed YOLO. Track [#23](https://github.com/Rajveerx11/neura/issues/23). |
| Human Away | Preview / blocked | Writable live-workspace mounting and repository-script indirection are unsafe for unattended production. Track [#24](https://github.com/Rajveerx11/neura/issues/24). |
| Automatic execution | Blocked | Proof and Git automation require pinned, contained execution. Track [#22](https://github.com/Rajveerx11/neura/issues/22). |
| Installation | Blocked | Atomic activation, rollback, file hashes, and unknown-extension detection are missing. Track [#21](https://github.com/Rajveerx11/neura/issues/21). |
| Credential incident | Blocked | Historical GitHub-token rotation must be verified and documented. Track [#36](https://github.com/Rajveerx11/neura/issues/36). |
| Plan confidentiality | Major gap | Broad searches can discover ignored or historical secrets. Track [#35](https://github.com/Rajveerx11/neura/issues/35). |
| Approvals | Major gap | Storage concurrency, tamper evidence, and remote endpoint binding need hardening. Track [#33](https://github.com/Rajveerx11/neura/issues/33). |
| Integrations and memory | Major gap | October, MCP, Gmail, memory, redaction, and credential scoping need work. Track [#29](https://github.com/Rajveerx11/neura/issues/29) and [#34](https://github.com/Rajveerx11/neura/issues/34). |
| Skills | Major gap | Enabled skills are not fully pinned, manifested, or isolated from personal state. Track [#38](https://github.com/Rajveerx11/neura/issues/38). |
| Type and test safety | Major gap | Strict compilation reports 246 source errors; hermetic, fuzz, race, and crash suites are incomplete. Track [#26](https://github.com/Rajveerx11/neura/issues/26) and [#27](https://github.com/Rajveerx11/neura/issues/27). |
| UX and accessibility | Major gap | Dangerous-state visibility and generated-plan accessibility need hardening. Track [#37](https://github.com/Rajveerx11/neura/issues/37). |
| Health and operations | Major gap | Health checks and diagnostics can overstate readiness. Track [#39](https://github.com/Rajveerx11/neura/issues/39) and [#30](https://github.com/Rajveerx11/neura/issues/30). |

## Production claim gate

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

- Source of truth remains `C:\Neura`; the live harness is generated.
- Plain Pi stays stock unless `NEURA` is set.
- The logo-only launch remains.
- Plan remains read-only except controlled plan publication.
- Deterministic policy outranks model review.
- Human Away remains preview-labelled.
- No automatic Git shipping returns.
- Credentials, memory, approvals, sessions, and raw transcripts stay out of source.

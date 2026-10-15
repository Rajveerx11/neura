# Production readiness

This document is durable gate between experimental engineering build and a
production-ready Neura release. GitHub issues hold implementation detail;
this file defines order, evidence, and the meaning of done.

## Current decision

Neura is **not production-ready**. Current supported scope is experimental,
personal, single-user engineering use. Human Away is preview-only.

Open-source publication is a separate decision governed by
[OPEN_SOURCE.md](OPEN_SOURCE.md). Public source does not satisfy any production
gate.

Milestone: [Production readiness](https://github.com/Rajveerx11/neura/milestone/1)

Roadmap: [#31](https://github.com/Rajveerx11/neura/issues/31)

## P0 release blockers

Issue state checked 2026-10-15. Merged improvements are in the experimental source candidate;
closing one issue does not establish production readiness.

| Issue | Required outcome |
|---|---|
| [#24](https://github.com/Rajveerx11/neura/issues/24) | Make Human Away transactional and resource bounded. |
| [#21](https://github.com/Rajveerx11/neura/issues/21) | Add a complete runtime manifest, atomic install, and rollback. |

## P1 hardening

| Area | Issues |
|---|---|
| Approval integrity | [#33](https://github.com/Rajveerx11/neura/issues/33) |
| Gmail and provider credentials | [#34](https://github.com/Rajveerx11/neura/issues/34) |
| Prompt ingress, memory, redaction, and MCP | [#29](https://github.com/Rajveerx11/neura/issues/29) |
| Strict typing | [#26](https://github.com/Rajveerx11/neura/issues/26) |
| Durable recovery | [#28](https://github.com/Rajveerx11/neura/issues/28) |
| Evaluation and operations | [#30](https://github.com/Rajveerx11/neura/issues/30) |

Full verified proof PASS is separately blocked by [#91](https://github.com/Rajveerx11/neura/issues/91);
quick detector PASS does not close that delivery gate.

## Completed source milestones

| Delivery | Covered outcome |
|---|---|
| [#22](https://github.com/Rajveerx11/neura/issues/22), closed | Exact executable identities, contained offline proof runtime, and restricted automatic Git/process behavior. This does not establish clean-host installation or full proof PASS. |
| [#25](https://github.com/Rajveerx11/neura/issues/25), closed | Shared runtime capability, policy, and process contracts. Strict typing remains #26. |
| [#35](https://github.com/Rajveerx11/neura/issues/35), closed | Scoped Plan confidentiality hardening, ignored/private read denial, and historical Git content denial; application-level containment retains documented race and ingress limits. |
| [#38](https://github.com/Rajveerx11/neura/issues/38), closed | Hashed, versioned repository-owned guidance with exact Pi compatibility and default-disabled opt-in. External skills remain unsupported. |
| [#39](https://github.com/Rajveerx11/neura/issues/39), closed | Core versus optional readiness, bounded probes, redacted errors, runtime identity, and remediation. Evaluation/operations remain #30. |
| [#36](https://github.com/Rajveerx11/neura/issues/36), closed | Owner-confirmed token revocation and replacement, value-free incident record, complete-history secret scanning, and negative regression coverage. |
| [#23](https://github.com/Rajveerx11/neura/issues/23), closed | Work is default; `work_exec` uses network-disabled WSL2 bubblewrap. This does not close every search/confidentiality gap. |
| [#27](https://github.com/Rajveerx11/neura/issues/27), closed | Isolated modular suites, seeded fuzzing, approval concurrency/crash rejection, and content-bound verification receipts. Strict typing remains #26. |
| [#37](https://github.com/Rajveerx11/neura/issues/37), closed | Deliberate YOLO confirmation, persistent danger treatment, and generated Plan accessibility coverage. |
| [PR #44](https://github.com/Rajveerx11/neura/pull/44), merged | Learn lessons, document grounding, bounded exercises, explicit progress, browser accessibility, and cross-mode regression coverage. Parser limits are not OS isolation; first store creation requires Windows. |

## Evidence required for closure

Every production issue must include:

1. The boundary or failure being changed.
2. Positive and negative regression tests.
3. Real integration evidence where mocks are insufficient.
4. Security and privacy impact.
5. Migration and rollback instructions.
6. Documentation updates.
7. Exact versions and integrity evidence for new dependencies.

An issue is not complete because code exists. It is complete when its acceptance
criteria pass, the evidence is linked, and the release documents are truthful.

## Release rehearsal

Before a production claim:

1. Start from a clean Windows host or disposable VM.
2. Install only from the candidate artifact and manifest.
3. Verify hashes, runtime versions, skills, extensions, and MCP packages.
4. Run unit, integration, adversarial, sandbox, accessibility, and secret scans.
5. Exercise Plan, Work, YOLO, Human Away, Learn, Gmail, and recovery. Include
   session replacement during background work, PDF/PPTX/OCR imports, citations,
   SQL denial, stale boards, explicit save/resume, and missing runtime failures.
6. Interrupt installation and active work to verify rollback and recovery.
7. Confirm the live manifest exactly matches the candidate.
8. Run a bounded soak period and record failures, latency, interventions, and resource use.

## Future-proofing rules

- Production claims follow evidence, not dates.
- New modes or integrations require explicit capability and threat models.
- No executable dependency may resolve a floating version at runtime.
- Optional capabilities cannot make core health appear failed.
- Unknown installed code cannot silently become part of Neura.
- Security exceptions require an owner, expiry, compensating control, and issue.
- Re-run this audit after any Pi upgrade, new provider, new sandbox boundary,
  installer change, or release-scope expansion.

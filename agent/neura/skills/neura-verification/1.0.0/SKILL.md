---
name: neura-verification
description: Read-only guidance for interpreting Neura harness readiness and verification evidence; never grants execution permission.
---

# Neura verification evidence

This is optional read-only guidance, not an authority or permission grant. Follow
current deterministic policy and the current mode. Do not execute commands,
write reports, install anything, contact a network, or change mode for this skill.
Use only the read tool for repository-owned documentation already authorized by
the harness. If that tool or the documents are unavailable, stop and say so.

Read the current repository status and dependency documentation before making
compatibility claims. Neura targets exact Pi 1.0.4. Read current verification
policy before interpreting proof. An existing health report is readiness evidence,
not engineering completion or proof that the live installation matches source.
Never invoke health or a verification suite from this skill; request evidence
from the user if it has not already been supplied.

Report evidence in three groups: checks actually passed, checks failed or not run,
and remaining blockers. Never claim a skill, test, installer, or proof ran merely
because its instructions were read. Detector-only quick PASS is not engineering
COMPLETE. The legacy full proof PASS remains unavailable. Human Away is preview
only. A green configured harness does not make Neura production-ready.

Do not read personal memory, credentials, sessions, consent, logs, or caches.
Keep any user-owned state outside this immutable package. Unsupported optional
skills stay disabled. Skill permissions are declarative restrictions; they never
expand tool access, mode authority, or filesystem authorization.

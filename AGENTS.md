# Repository instructions

## Source and scope

- `C:\Neura` is source of truth. `~/.pi/agent/` is a generated live install.
- Read `docs/STATUS.md` before changing policy, modes, proof, autogit, Gmail, or approvals.
- Keep current release status honest. Human Away is preview-only.
- Preserve the logo-only launch in `agent/extensions/neura.ts`.

## Change rules

- Make scoped changes. Preserve unrelated user work.
- Never store or print credentials, private memory, approval logs, or session data.
- Do not install into the live harness, commit, tag, push, publish, or mutate remote
  systems unless the user explicitly authorizes that action.
- New runtime dependencies require an exact pin, source review, documentation, and tests.
- Security-boundary changes require positive and negative regression tests.

## Required checks

```powershell
node scripts\verify-harness.mjs
node scripts\check-docs.mjs
git diff --check
```

Run `powershell -File .\install.ps1 -Check` when live drift matters. A failing
drift check is not permission to install.

## Key invariants

- Neura-specific extensions gate on `NEURA`; plain Pi stays stock.
- Plan is read-only except for `publish_plan` under `plans/`.
- Filesystem authorization uses canonical junction-aware containment.
- Deterministic policy outranks Headmaster or model output.
- Widgets fit Pi's ten-line cap and supported terminal widths.
- Plans are historical design evidence. Current requirements live in source,
  `README.md`, `docs/STATUS.md`, and `SECURITY.md`.

# Installer readiness

Updated 2026-11-07. The active installer creates a **source-linked development
launcher**, not a complete distributable runtime. Work/Learn testing remains
limited to synthetic, non-sensitive data while Mastra EE/distribution approval
is unresolved. See [setup](../README.md#quick-start-from-source).

## Current behavior

```powershell
powershell -NoProfile -File .\install.ps1 -Development
powershell -NoProfile -File .\install.ps1 -Check
Get-Command neura -All
```

`-Development` intentionally opts into a mutable checkout launcher. It requires
native Windows, supported Node, both installed dependency graphs and an ASCII-only
checkout path without unsupported command-shell characters. It does not bootstrap
Node, WSL, bubblewrap, a model server or credentials. The active app needs no Pi.

The installer records ownership, preserves unknown/modified launchers and backs
up a receipt-owned legacy launcher before replacement. `-Check` is read-only,
checks source/launcher selection and does not authorize repair. It does not prove
a sealed runtime, DACL privacy, model entitlement or actual WSL execution.

The launcher executes the checkout's current bytes, including uncommitted changes.
It has no automatic updater. There is no full-runtime activation transaction or
automatic rollback command. Current installer tests are synthetic preservation/path
contracts, not clean-host distribution acceptance.

## Preservation and legacy retirement

Never overwrite an unowned launcher or erase private profiles. Legacy credentials,
memory, approvals, sessions, vaults, user-authored reference material and other
agents' worktrees are not cleanup targets.

`scripts/retire-pi-neura.ps1` defaults to read-only inventory. Its separate,
explicitly authorized `-Apply` operation moves only receipt/hash-matched managed
files reversibly and refuses while Pi agents are active. It does not uninstall
standalone Pi or wipe profiles. Retirement is not needed to evaluate the Mastra
launcher. The owner's prior authorized retirement is recorded in
[dated evidence](MASTRA_V1.md#legacy-source-and-machine-state). It does not
authorize another installation or cleanup of unmatched data.

## Rollback

Exit Neura before modifying source or launcher. Invoke a known-good checkout
explicitly, or restore only a verified installer-owned backup after checking the
destination is still owned. Preserve dirty source, recovery receipts and private
data. Do not downgrade standalone Pi or delete audit/history files to force success.

## Distribution gates

| Gate | Required outcome |
| --- | --- |
| Licensing | Resolve Mastra EE scope, third-party notices, artwork rights and owner distribution approval |
| Runtime closure | Define a complete Pi-free runtime manifest with exact packages/platforms and integrity, backed by ownership receipts |
| Bootstrap | Review delivery/authenticity and Node/runtime provisioning. Source archives are insufficient |
| WSL setup | Explicit administrator/reboot handling, distro/bubblewrap/toolchain provisioning and offline proof artifacts |
| Recovery | Test interrupted install/upgrade, rollback, path swaps, modified/unowned targets and component consistency |
| Isolation | Pass actual Work sandbox acceptance and the separate live replay on a configured disposable host |
| Clean-host acceptance | Verify a new unprivileged Windows profile without relying on the maintainer's installed state |
| Release | Independent review, required candidate CI, audits/signatures, secret scan and [release checklist](RELEASING.md) |

`verify:release` remains blocked. The archived Pi installer at `legacy/pi/install.ps1`
has old path assumptions and is not a current installation path. Historical
[2026-10-20 installer evidence](https://github.com/Rajveerx11/neura/blob/6a63952/docs/INSTALLER_READINESS.md)
belongs to the earlier Pi candidate. It does not certify the Mastra launcher.

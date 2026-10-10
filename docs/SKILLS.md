# Reproducible optional skills

Neura supports one repository-owned, read-only guidance skill:
`neura-verification` version `1.0.1`. It interprets existing harness/proof evidence;
it does not execute verification, health, installers, network calls, or writes.
It is **disabled by default**. Unsupported optional/personal skills are outside
this supported catalog; do not enable them as Neura capabilities.

## Identity and opt-in

The machine-readable catalog is
[`agent/neura/skills-manifest.json`](../agent/neura/skills-manifest.json).
Each entry records the repository and source path, immutable package version,
SHA-256 of its only file (`SKILL.md`), exact Pi compatibility (`1.1.0`), owner,
update policy, empty dependency list, and declarative permission restrictions.
The managed release manifest also hashes the catalog, validator, and package.
Versioned content plus digest avoids a circular hash of the commit containing
that same manifest. Source delivery retains normal Git review history.

To opt in explicitly, create `~/.pi/neura-skills.json` outside the package:

```json
{"schemaVersion":1,"enabled":["neura-verification"]}
```

Omit the file, or use an empty `enabled` array, to disable all supported skills.
Restart/reload Pi after changing the selection. Selection is machine-local;
it is neither packaged nor overwritten by installation. It is not an approval
or permission grant. No enable command writes consent or other personal state.

The existing installer stages these files through its managed-file transaction,
without new dependencies or network/install actions for the skill. It validates
catalog and selection before staging, checks release ownership and exact hashes,
and rejects duplicate names/paths and symlinks/junctions in path ancestors.
Internal recovery validates package integrity independently of local selection,
so a broken opt-in file does not prevent rollback. Only rollback of a wholly
pre-catalog staged release may omit skill validation: its manifest and receipt
must declare no skill files, and all physical registry components must be absent.
Partial catalogs, dangling links, receipt/hash drift, and invalid journals remain
rejected. Before recovery mutates targets or backup inventory, the next receipt
must contain only release-owned files, the release manifest, the Learn receipt,
and bounded Learn module paths; self-consistent receipt-only extra hashes do not
grant ownership. This compares ownership to staged release declarations; it does
not authenticate a mutable staged manifest or transaction against same-user
compromise. A fabricated manifest declaration is outside this guarantee.
New preparation, sealing, activation and launch checks still require
the supported registry. Launch checks and runtime
resource discovery fail closed for invalid supported selections. The catalog,
validator, discovery gate and managed installer are protected-control paths;
headless Work blocks direct edits and sandbox commands naming canonical aliases
of these paths. Filesystem tools reject NTFS streams (including `::$DATA`),
drive-relative paths, and UNC/device/extended namespaces before filesystem
inspection or approval; use ordinary local-drive paths. Shell screening uses
recognized path operands rather than interpreting every colon as a filename:
patterns, Git objects, script selectors and code can contain colons. Unsupported
recognized paths reject. In development or bounded-delete contexts, stream
operands with existing extensionless bases also reject; existence alone does not
classify unknown command text. Ambiguous colon arguments or option values require
human review, never automatic execution. Ordinary-base existence is mutable
and is not an authorization guarantee. No unsupported stream target is probed.
These application checks are not a complete shell parser and do not make arbitrary
repository scripts a sandbox.
Similarly named ordinary task files remain task-scoped. Plain Pi is
unchanged by the Neura extension.

## Validation and health

`/skill-doctor` is now read-only and available without switching to YOLO. It
validates the supported registry and the current Pi command registry's reserved
skill identities, without scanning personal directories or validating unrelated
stock skills, and writes no report. Use `/skill-doctor` for the exact catalog
SHA-256 and validation PASS/FAIL. `/health` retains its existing YOLO diagnostic
requirement; its structured capability data carries optional skill state and the
same identity/validation label, but its compact widget summarizes readiness
without displaying the exact skill digest. Selection alone cannot establish
runtime readiness: enabled skills must
be discovered at the exact selected package path with matching content. A default
Pi skill winning a reserved name makes the supported capability unhealthy and
prevents Neura from appending supported paths. Remove the collision and reload.
Pi's public extension API does not remove an already loaded external winner; that
external remains stock Pi guidance, never an attested Neura capability. Missing
runtime identity also fails closed.
Missing/invalid catalogs report unhealthy rather than a misleading directory
count. A valid disabled catalog reports disabled, not missing or production-ready.

Validation rejects invalid metadata/provenance, compatibility drift, unavailable
or disallowed tool references, destructive commands, network/install instructions,
floating versions/dependencies, and linked resources unsupported by this profile.
Only `SKILL.md` is allowed in a package: no executable dependencies, caches,
logs, generated artifacts, memory, credentials, or consent state. All such
user-owned state must remain outside the immutable packages. Errors never echo
package text or selection data. Real Pi loader smoke tests run in the installer
suite, along with positive opt-in and negative manifest/content/junction tests.

This is a narrow reviewed guidance profile, not a general skill sandbox or a
proof that arbitrary natural-language instructions are safe. Permissions are
**restrictions, never grants**. Existing deterministic policy, tool authorization,
mode controls, and filesystem containment remain authoritative. External skills
configured directly in stock Pi are not attested by this registry or health.

## Owner and updates

Owner: `Rajveerx11`. Changes require review, a new package version and digest,
updated exact compatibility and release hashes, and passing real-loader smoke
and negative validation tests. Do not edit an installed immutable package or
reuse a version for different content. No automatic updates or floating sources.
Version `1.0.1` advances the guidance text from Pi `1.0.4` to `1.1.0` without
reusing the former `1.0.0` content identity. Synthetic installer tests retain
same-version mutation rejection and new-version upgrade/retired-file cleanup.
Any latest-stable Pi update must update and validate this exact compatibility
contract together with Neura's existing pins; never downgrade Pi to fit a skill.

This source-only slice does not attest a clean-host install, live drift, release,
or production readiness. Human Away remains preview-only.

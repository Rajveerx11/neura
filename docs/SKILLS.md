# Reproducible optional skills

Neura supports one repository-owned, read-only guidance skill:
`neura-verification` version `1.0.0`. It interprets existing harness/proof evidence;
it does not execute verification, health, installers, network calls, or writes.
It is **disabled by default**. Unsupported optional/personal skills are outside
this supported catalog; do not enable them as Neura capabilities.

## Identity and opt-in

The machine-readable catalog is
[`agent/neura/skills-manifest.json`](../agent/neura/skills-manifest.json).
Each entry records the repository and source path, immutable package version,
SHA-256 of its only file (`SKILL.md`), exact Pi compatibility (`1.0.4`), owner,
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
so a broken opt-in file does not prevent rollback. Launch checks and runtime
resource discovery fail closed for invalid supported selections. Plain Pi is
unchanged by the Neura extension.

## Validation and health

`/skill-doctor` is now read-only and available without switching to YOLO. It
validates the supported registry and the current Pi command registry's reserved
skill identities, without scanning personal directories or validating unrelated
stock skills, and writes no report. `/health` retains its existing YOLO diagnostic
requirement but reports optional skill state, exact catalog SHA-256, and validation
PASS/FAIL. Selection alone cannot establish runtime readiness: enabled skills must
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
Any latest-stable Pi update must update and validate this exact compatibility
contract together with Neura's existing pins; never downgrade Pi to fit a skill.

This source-only slice does not attest a clean-host install, live drift, release,
or production readiness. Human Away remains preview-only.

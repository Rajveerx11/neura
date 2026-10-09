# Plan confidentiality (source-only)

Neura Plan replaces SDK `read`, `grep`, `find`, `ls`, and `bash` with authorized
local inspection. Plain Pi registers no wrappers; outside Plan each wrapper
delegates to the current SDK implementation. Controlled `publish_plan` is unchanged.
This is experimental source hardening, not a release or live-install claim.

## File boundary

Each concrete entry is authorized before listing, traversal, or content delivery:

- lexical and canonical paths must remain within the current workspace;
- environment/credential paths, Git internals, private memory/session/approval
  stores, and private/secrets directories are excluded;
- workspace `.gitignore`, `.git/info/exclude`, and configured **global** exclusions
  apply even to tracked files (`check-ignore --no-index`), including explicit
  `GIT_CONFIG_GLOBAL`, HOME config, and `XDG_CONFIG_HOME/git/config` or the
  default XDG `git/ignore` lookup;
- in-workspace links to authorized source are usable; outside/ignored links,
  junction escapes, hard-linked files, special files, and files above 8 MiB are not;
- an opened descriptor is checked against authorized file identity before and
  after reading, with path/ignore authorization repeated before returning bytes;
- only UTF-8 text is delivered. Binary/images are denied because opaque payloads
  cannot be text-redacted. Secret patterns are redacted before search/read output;
  private-key block boundaries are scanned once rather than retried per header.

Git exclusion checks are bounded metadata-only subprocesses using trusted Git,
not a shell. Only this query consults global configuration; fixed overrides disable
hooks, filesystem monitors, pagers, filters, external diff, credential prompting,
and lazy fetch. Config errors, missing Git, and timeouts fail closed. Config contents
and subprocess diagnostics are never returned to the model. Non-Git workspaces
still use containment/private-path rules; Git exclusions apply in Git workspaces.

Enumeration reauthorizes every entry; it never sends broad host-tool search output
to the model and then tries to filter it. Traversal deduplicates canonical
directories (including link cycles), observes cancellation between entries and
within file scans, and is bounded to 10 seconds/10,000 entries. Grep checks the
clock/abort signal on every line and yields every 32 lines. The same budget is
checked during chunked descriptor reads and redaction preprocessing; private-key
and URL-credential failed matches no longer retry every suffix. Deadline expiry
and cancellation are explicit errors, not successful no-match results. Narrow the
path when an entry/match limit notice appears. SDK read offset/limit and
2,000-line/50-KiB output truncation remain; other inspection output uses SDK head
truncation. Search has bounded match/context limits. Files above 8 MiB and grep
lines above 16,384 characters produce explicit size-limit errors, including in
recursive searches; matching input is not silently clipped. Displayed lines are
clipped to 500 characters.

## Plan bash is an adapter, not a shell

Only these closed forms are supported (one pattern/path argument, optionally
quoted; no expansion, scripts, pipelines, composition, or arbitrary options):

```text
pwd
Get-Location
git rev-parse --short HEAD
rg [-n] [-i] [-F] pattern [path]
rg --files [path]
Get-Content [-LiteralPath] path
ls [path]
Get-ChildItem [-LiteralPath] [path]
Select-String -LiteralPath path -Pattern pattern
```

These map to the same file service. No model-supplied command is executed on the
host. **Git historical content is denied**, including show, patch/log/diff,
cat-file, historical grep and reflog. Only the fixed current-HEAD hash query is
supported; its shared Git hardening does not consult global config.

Use structured tools for offset/limit/context/glob options. Grep supports literal
text or simple regex alternatives, character classes, anchors and single-character
`.`. Repetition (including `.*`), groups, escapes/backreferences and arbitrary regex
are unsupported and explicitly rejected; use `literal=true` (`rg -F`) for such
text. Without repetition, per-line matching work is bounded by the capped line
and pattern lengths (patterns are at most 500 characters). Glob supports `*`,
`**`, and `?` only. These intentionally small subsets keep inspection useful
without a general shell parser or unbounded regex execution.

## Last-mile defense and limits

Plan tool-result content, details and structured output are redacted. Restored or
previous-mode tool results not authorized by the current Plan service are withheld
from Plan context; re-inspect through the authorized tools. Final
`context_with_system` redaction covers conversation text and system sections while
preserving Pi tool declarations. Opaque images from earlier modes are withheld.

Redaction is defense-in-depth, not proof that arbitrary secrets can be recognized.
It cannot make a model forget content previously sent in another mode. Concurrent
hostile filesystem changes are checked with canonical containment and descriptor
identity, but this application-level policy is not OS isolation or an atomic
filesystem snapshot. Untrusted extensions injecting later context, startup resource
loading, memory/network integrations, and executable-dependency trust have separate
hardening gates (#38, #34, #29). No broader production-readiness claim is made.

Evidence: `scripts/tests/plan-confidentiality.mjs` runs through the real Pi loader
and session, including SDK wrapper selection, source-positive/private-negative
controls, tracked/global ignores, Git-history denial, links/junctions/hardlinks,
file/link races, XDG direct-read/recursive-search denial, hostile failed-match
rejection, mid-file cancellation/deadline, explicit size limits, truncation,
final-context text/opaque-image redaction, native
outside-Plan delegation, and stock Pi. It runs as part of `npm run test:plan`.

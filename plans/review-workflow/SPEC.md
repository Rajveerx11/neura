# Work-mode engineering workflow — implementation spec

Owner-approved 2026-11-02. Manager thread: thr_zp5pswvmrx. This is the contract
both implementation agents code against. Do not change a signature here without
telling the manager.

## Goal (end to end, not a prototype)

Default flow for every Work turn that changes the workspace:

```
baseline snapshot → builder turn (existing runTurn) → candidate snapshot
  → no change?  stop (skipped)
  → assessRisk(changed files) → trivial? stop (skipped, reason shown)
  → independent read-only review bound to candidate fingerprint
  → controller computes mustFix deterministically
  → mustFix findings? feed them to builder as a fix turn, re-snapshot, re-review
     (max 3 review rounds) → still failing → BLOCKED with remaining findings
  → clean → READY FOR YOUR APPROVAL (never commits, pushes or merges)
```

Rules that are not negotiable:

- Risk is path/content based, not diff size. Bug fix and risky are not exclusive.
- Severity and likelihood are separate fields. No multiplied score.
- `mustFix` is computed by the controller, never trusted from model output:
  `severity === 'blocker'` (any likelihood/confidence), or
  `severity === 'major' && confidence !== 'low'`.
- A review receipt is valid only for its candidate fingerprint. Any later edit
  makes it `stale`. Never reuse a clean review for different code.
- Reviewer gets fresh context and read-only tools enforced in code (read + ls
  only; no write/edit/work_exec, no network). A prompt saying "don't edit" is not
  the boundary.
- Missing reviewer/model/git → `unavailable` → workflow `blocked`. Never a silent pass.
- Reviewer independence: different provider family from builder = `cross-family`.
  Same family = `same-family`, allowed but labelled weaker in output.
- Bounded autonomy: builder auto-fixes mustFix findings; existing per-command
  approvals still apply. Non-mustFix findings are shown to the user, not fixed.
- No new dependencies. Reuse `agent/neura/verification.ts` (`captureWorktree`,
  `TreeSnapshot`), `src/runtime.ts` (`runTurn`), `src/providers.ts`
  (`createConfiguredModel`, `ProviderConfig`), `agent/neura/redaction.ts`.
- Nothing is persisted outside session memory in this slice.

## Module A — `src/review.ts` (Agent A owns; also owns `src/work.ts`)

```ts
import type { TreeSnapshot } from '../agent/neura/verification.ts';
import type { ProviderConfig } from './providers.ts';

export type Risk = { level: 'trivial' | 'normal' | 'high'; reasons: string[] };
/** Deterministic. high: auth/credential/token/secret/session/permission/policy/
 *  sandbox/security/crypto paths, migrations/*.sql, package manifests/lockfiles,
 *  CI/workflow files, install/launcher scripts. trivial: only docs/text
 *  (*.md, *.txt, *.rst, LICENSE...) and nothing high. else normal. */
export function assessRisk(changed: string[]): Risk;

/** Paths whose hash differs, plus added and deleted paths. Sorted. */
export function changedFiles(before: TreeSnapshot, after: TreeSnapshot): string[];

export type Finding = {
  id: string;                       // stable within a receipt, e.g. "F1"
  severity: 'blocker' | 'major' | 'minor';
  likelihood: 'likely' | 'possible' | 'rare';
  confidence: 'high' | 'medium' | 'low';
  file: string; line?: number;
  summary: string; evidence: string;
  mustFix: boolean;                 // computed by isMustFix, not by the model
};
export function isMustFix(f: Pick<Finding, 'severity' | 'confidence'>): boolean;

export type ReviewReceipt = {
  schemaVersion: 1; id: string;
  fingerprint: string | null;
  status: 'clean' | 'findings' | 'unavailable' | 'stale';
  reviewer: { provider: ProviderConfig['provider']; model: string; independence: 'cross-family' | 'same-family' };
  risk: Risk;
  findings: Finding[];
  reason?: string;                  // human-readable for unavailable/stale
  completedAt: string;
};

export type ReviewInput = {
  workspace: string;
  task: string;                     // the user's original request (+ prior fix context)
  baseline: TreeSnapshot;           // snapshot before the builder turn
  reviewer: ProviderConfig;
  builder: ProviderConfig;
  signal?: AbortSignal;
};
/** Captures candidate, builds bounded diff (tracked: git diff vs baseline content
 *  where available / HEAD; new files: bounded content), runs one fresh runTurn with
 *  read-only tools and REVIEW_INSTRUCTIONS, parses strict JSON findings (zod),
 *  re-captures after review: fingerprint changed → 'stale'. Unparseable output or
 *  model/tool failure → 'unavailable' with reason. Injectable deps for tests. */
export async function reviewCandidate(input: ReviewInput, deps?: Partial<ReviewDeps>): Promise<ReviewReceipt>;
export type ReviewDeps = { capture: typeof import('../agent/neura/verification.ts').captureWorktree; runTurn: typeof import('./runtime.ts').runTurn; createModel: typeof import('./providers.ts').createConfiguredModel };

/** Current-candidate check used by /review status. */
export async function reviewReceiptCurrent(workspace: string, receipt: ReviewReceipt, signal?: AbortSignal): Promise<boolean>;
```

`src/work.ts` change: add `createReadOnlyTools(workspace, generation)` returning
only `read` and `ls` (share code with `createWorkspaceTools`, no duplication),
used by the reviewer. Do not touch `WORK_INSTRUCTIONS` (Agent B appends its own).

Tests: `tests/v1-review.test.ts` — risk routing (auth tiny change = high, docs =
trivial, mixed = high), changedFiles add/delete/modify, isMustFix table incl.
rare blocker = must fix, read-only tools contain no effectful tool (positive and
negative), JSON parse failure → unavailable, model failure → unavailable,
fingerprint drift during review → stale, independence labelling. Register suite
`review` in `scripts/verify-harness.mjs`.

## Module B — `src/workflow.ts` + `src/cli.ts` (Agent B owns)

```ts
import type { ReviewReceipt, ReviewInput } from './review.ts';
export const MAX_REVIEW_ROUNDS = 3;
export const WORKFLOW_INSTRUCTIONS: string; // appended to WORK_INSTRUCTIONS in cli.ts:
  // assess task; for bugs reproduce the failing behavior through the real path
  // before editing and re-run the same path after; for risky changes investigate
  // first; run relevant tests/typecheck via work_exec; report concrete evidence;
  // an independent reviewer will check the result; never claim review/verification.
export type WorkflowState = 'skipped' | 'ready' | 'blocked';
export type WorkflowOutcome = { state: WorkflowState; rounds: number; receipt?: ReviewReceipt; reason: string };
export type WorkflowDeps = {
  capture: (workspace: string, signal?: AbortSignal) => Promise<TreeSnapshot | null>;
  review: (input: ReviewInput) => Promise<ReviewReceipt>;
  fixTurn: (prompt: string) => Promise<void>;   // cli runs a normal builder turn
  current: () => boolean;                       // generation/mode fence
  report: (line: string) => void;
};
/** Controller. Called after a builder turn with the pre-turn baseline. */
export async function runReviewLoop(args: { workspace; task: string; baseline: TreeSnapshot | null; reviewer; builder; signal? }, deps: WorkflowDeps): Promise<WorkflowOutcome>;
export function formatFindings(receipt: ReviewReceipt): string;   // terminal text
export function fixPrompt(receipt: ReviewReceipt): string;        // only mustFix findings
```

CLI wiring (`src/cli.ts`):
- Work turn: capture baseline before builder `runTurn`; after it, if workflow on,
  call `runReviewLoop`. Fix rounds call the existing turn path (history saved).
  Learn mode untouched. Baseline null (not a git repo) → print blocked reason once.
- Reviewer config: `--reviewer-provider`, `--reviewer-model`, `--reviewer-base-url`,
  env `NEURA_REVIEWER_PROVIDER/MODEL/BASE_URL`; default = builder provider+model
  (same-family, labelled). `/reviewer` shows; `/reviewer PROVIDER MODEL [URL]` sets.
- `/review` runs a manual review of the current candidate vs session baseline;
  `/review status` reports whether last receipt is current.
- `/workflow on|off` (default on in Work). Off = previous behavior.
- Update `/help` and `--help` text.
- Generation/mode fences: any `/mode`, `/new`, `/model`, `/login` invalidates an
  in-flight loop (use existing `generation`).
- Final line always one of: `READY FOR YOUR APPROVAL ...`, `BLOCKED: <reason>`,
  `Review skipped: <reason>`. Never commits/pushes.

Tests: `tests/v1-workflow.test.ts` with fake deps — clean first round → ready;
mustFix then clean → ready after 2 rounds; persistent mustFix → blocked at 3;
unavailable → blocked; stale → blocked; no change → skipped; trivial → skipped;
non-mustFix findings only → ready with findings shown; fence change mid-loop →
aborted. Register suite `workflow`. Extend `tests/v1-cli.test.ts` only for new
argument/command parsing if cheap.

## Shared rules for both agents

- Shared checkout `C:\Neura`, no worktrees. Edit only files you own. Untracked
  `assets/linkedin/*` and `docs/MASTRA_MIGRATION_REFERENCE.md` are the user's.
- Do not commit, push, install, or modify `~/.pi` or `~/.neura`.
- Agent B: until `src/review.ts` exists, code against the types above via
  `import type`; tests use fakes so they do not need Agent A's code.
- Typecheck errors inside the other agent's files are not yours; mention, don't fix.
- Docs (README/STATUS/VERIFICATION) are the manager's job. Don't edit them.

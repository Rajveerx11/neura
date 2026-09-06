import { repoRoot, scratchRoot, assert, fs, path, files, state, appendedEntries, sentUserMessages, extensionWithTool, firstHandler, context, modes } from './harness.mjs';
const theme = JSON.parse(fs.readFileSync(path.join(repoRoot, 'agent/themes/neura-dark.json'), 'utf8'));
await modes.commands.get("mode").handler("plan", context);
// Plan publication: structured input, escaped browser output, collision-safe creation,
// explicit clarification/new/revision lifecycle, one-artifact-per-request binding,
// session-owned revision, external-edit protection, and symlink fail-closed behavior.
const planArtifact = extensionWithTool("publish_plan");
const headlessPlanContext = { ...context, mode: "json", hasUI: false };
const planContractEntries = () => appendedEntries.filter((entry) => entry.customType === "neura-plan-contract");
const completedPlanRun = { messages: [{ role: "assistant", stopReason: "stop" }] };
const failedPlanRun = { messages: [{ role: "assistant", stopReason: "error" }] };
const abortedPlanRun = { messages: [{ role: "assistant", stopReason: "aborted" }] };
await firstHandler(planArtifact, "session_start")({}, headlessPlanContext);
sentUserMessages.length = 0;
await firstHandler(planArtifact, "input")({ source: "interactive", text: "Plan this change" }, headlessPlanContext);
const planRequest = planArtifact.tools.get("plan_request").definition.execute;
await planRequest("plan-wait-steer", { action: "wait_for_input" }, undefined, undefined, headlessPlanContext);
await firstHandler(planArtifact, "agent_end")(completedPlanRun, headlessPlanContext);
await firstHandler(planArtifact, "agent_settled")({}, headlessPlanContext);
assert.equal(sentUserMessages.length, 0, "Material clarification triggered a publication retry before the user could answer");
assert.equal(planContractEntries().filter((entry) => entry.data?.status === "failed").length, 0, "Waiting headless Plan request reported a contract failure");
await firstHandler(planArtifact, "input")({ source: "interactive", streamingBehavior: "steer", text: "Questionnaire answer: keep compatibility" }, headlessPlanContext);
const retriesBeforeNativeRecovery = sentUserMessages.length;
for (const incompleteRun of [failedPlanRun, abortedPlanRun]) {
  await firstHandler(planArtifact, "agent_end")(incompleteRun, headlessPlanContext);
}
assert.equal(sentUserMessages.length, retriesBeforeNativeRecovery, "Provider recovery consumed the Plan publication retry");
await planRequest("plan-wait-follow-up", { action: "wait_for_input" }, undefined, undefined, headlessPlanContext);
await firstHandler(planArtifact, "agent_end")(completedPlanRun, headlessPlanContext);
await firstHandler(planArtifact, "agent_settled")({}, headlessPlanContext);
assert.equal(sentUserMessages.length, 0, "Steered clarification answer did not preserve a deliberate second wait");
await firstHandler(planArtifact, "input")({ source: "interactive", streamingBehavior: "followUp", text: "Follow-up answer: preserve the current API" }, headlessPlanContext);
await firstHandler(planArtifact, "agent_end")(completedPlanRun, headlessPlanContext);
assert.equal(sentUserMessages.length, 1, "Headless clarification answer did not resume the request's one-retry publication contract");
assert.match(sentUserMessages[0].content, /call publish_plan/, "Plan retry did not name the required publisher");
await firstHandler(planArtifact, "session_start")({}, {
  ...headlessPlanContext,
  sessionManager: {
    getBranch: () => appendedEntries.map((entry) => ({ type: "custom", ...entry })),
  },
});
await planRequest("plan-wait-after-retry", { action: "wait_for_input" }, undefined, undefined, headlessPlanContext);
await firstHandler(planArtifact, "input")({ source: "interactive", streamingBehavior: "followUp", text: "Final clarification answer" }, headlessPlanContext);
await firstHandler(planArtifact, "agent_end")(completedPlanRun, headlessPlanContext);
await firstHandler(planArtifact, "agent_settled")({}, headlessPlanContext);
await firstHandler(planArtifact, "agent_settled")({}, headlessPlanContext);
assert.equal(sentUserMessages.length, 1, "Session restart allowed a second publication retry for one request");
const missingPlanFailures = planContractEntries().filter((entry) => entry.data?.status === "failed");
assert.equal(missingPlanFailures.length, 1, "Headless missing publication did not emit exactly one machine-readable failure");
assert.deepEqual(
  missingPlanFailures[0].data,
  {
    version: 1,
    status: "failed",
    code: "PLAN_ARTIFACT_MISSING",
    attempts: 2,
    retries: 1,
    maxRetries: 1,
    message: "Plan mode ended without an HTML artifact. No source changes were allowed.",
  },
  "Headless missing-publication contract changed",
);
await firstHandler(planArtifact, "session_start")({}, {
  ...headlessPlanContext,
  sessionManager: {
    getBranch: () => appendedEntries.map((entry) => ({ type: "custom", ...entry })),
  },
});
await firstHandler(planArtifact, "agent_settled")({}, headlessPlanContext);
assert.equal(planContractEntries().filter((entry) => entry.data?.status === "failed").length, 1, "Session restart duplicated a terminal Plan contract failure");
const rpcPlanContext = { ...context, mode: "rpc", hasUI: true };
const retriesBeforeRpcWait = sentUserMessages.length;
const failuresBeforeRpcWait = planContractEntries().filter((entry) => entry.data?.status === "failed").length;
await firstHandler(planArtifact, "session_start")({}, rpcPlanContext);
await firstHandler(planArtifact, "input")({ source: "rpc", text: "Plan an RPC change" }, rpcPlanContext);
await planRequest("plan-rpc-wait", { action: "wait_for_input" }, undefined, undefined, rpcPlanContext);
await firstHandler(planArtifact, "agent_end")(completedPlanRun, rpcPlanContext);
await firstHandler(planArtifact, "agent_settled")({}, rpcPlanContext);
assert.equal(sentUserMessages.length, retriesBeforeRpcWait, "Waiting RPC Plan request triggered a publication retry");
assert.equal(planContractEntries().filter((entry) => entry.data?.status === "failed").length, failuresBeforeRpcWait, "Waiting RPC Plan request reported a contract failure");
await firstHandler(planArtifact, "session_start")({}, headlessPlanContext);
await firstHandler(planArtifact, "input")({ source: "interactive", text: "Plan after provider recovery" }, headlessPlanContext);
const retriesBeforeTerminalFailure = sentUserMessages.length;
const failuresBeforeTerminalFailure = planContractEntries().filter((entry) => entry.data?.status === "failed").length;
await firstHandler(planArtifact, "agent_end")(failedPlanRun, headlessPlanContext);
await firstHandler(planArtifact, "agent_settled")({}, headlessPlanContext);
const terminalFailure = planContractEntries().at(-1);
assert.equal(sentUserMessages.length, retriesBeforeTerminalFailure, "Terminal provider failure consumed the Plan retry");
assert.equal(terminalFailure?.data?.status, "failed", "Terminal provider failure did not emit a machine-readable Plan failure");
assert.equal(terminalFailure?.data?.retries, 0, "Terminal provider failure reported an unused Plan retry as consumed");
await firstHandler(planArtifact, "input")({ source: "interactive", text: "Continue after the terminal failure" }, headlessPlanContext);
await firstHandler(planArtifact, "agent_end")(completedPlanRun, headlessPlanContext);
await firstHandler(planArtifact, "agent_settled")({}, headlessPlanContext);
assert.equal(sentUserMessages.length, retriesBeforeTerminalFailure, "Later input reopened a terminal Plan retry without an explicit request reset");
assert.equal(planContractEntries().filter((entry) => entry.data?.status === "failed").length, failuresBeforeTerminalFailure + 1, "Later input duplicated a terminal Plan failure");
assert.equal(planContractEntries().at(-1), terminalFailure, "Later input replaced terminal failure with a nonterminal contract state");
const publishPlan = planArtifact.tools.get("publish_plan").definition.execute;
const planWorkspace = path.join(scratchRoot, "plan-workspace");
fs.mkdirSync(path.join(planWorkspace, ".git"), { recursive: true });
fs.mkdirSync(path.join(planWorkspace, "plans"), { recursive: true });
const existingPlan = path.join(planWorkspace, "plans", "plan-mode-v1-plan.html");
fs.writeFileSync(existingPlan, "human-owned plan", "utf-8");
const publishContext = { ...headlessPlanContext, mode: "print", cwd: planWorkspace };
await firstHandler(planArtifact, "session_start")({}, publishContext);
await firstHandler(planArtifact, "input")({ source: "interactive", text: "Publish a headless Plan artifact" }, publishContext);
const messagesBeforeRecoveredPublication = sentUserMessages.length;
await firstHandler(planArtifact, "agent_end")(failedPlanRun, publishContext);
assert.equal(sentUserMessages.length, messagesBeforeRecoveredPublication, "Provider error queued a stale retry before successful publication");
const planFixture = {
  slug: "plan-mode-v1",
  title: "Plan mode visual publishing",
  brief: "Create one researched visual HTML plan while keeping every normal source mutation blocked.",
  current: "Plan mode researches safely but returns only a numbered chat response.",
  target: "Plan mode publishes one validated local HTML artifact after an evidence pass.",
  done: "A reviewer can open the plan, understand the work, and approve it without reading chat history.",
  evidence: [
    { source: "agent/extensions/modes.ts", finding: "Current prompt requests a numbered plan and stops before implementation." },
    { source: "<script>alert(1)</script>", finding: "Untrusted plan text must be escaped before browser rendering." },
  ],
  preview: {
    title: "Proposed Plan review cockpit",
    caption: "Directional preview for review before implementation.",
    regions: [
      { title: "Evidence", tone: "neutral", items: ["Files and primary sources", "Current constraints"] },
      { title: "Future state", tone: "accent", detail: "What the completed surface may look like.", items: ["Visible hierarchy", "<img src=x onerror=alert(1)>"] },
      { title: "Approval", tone: "success", items: ["Proof checklist", "Approve or refine"] },
    ],
  },
  visuals: [{
    kind: "flow",
    title: "Planning workflow",
    caption: "Research precedes publication and approval.",
    groups: [
      { title: "Research", tone: "neutral", items: ["Read code", "Check primary sources"] },
      { title: "Publish", tone: "accent", items: ["Render safe HTML", "Write only inside plans/"] },
      { title: "Review", tone: "success", items: ["Open artifact", "Approve or refine"] },
    ],
  }],
  steps: [
    { title: "Add publisher", what: "Register a structured Plan-only publication tool.", why: "Generic write access would weaken the boundary.", files: ["agent/extensions/plan-artifact.ts"], proof: "Only publish_plan can create a file in Plan mode." },
    { title: "Verify safety", what: "Exercise path, overwrite, escaping, and mode boundaries.", why: "The exception must fail closed under hostile input.", files: ["scripts/verify-harness.mjs"], proof: "Negative tests pass and normal writes stay blocked." },
  ],
  included: ["Structured local HTML plans", "Research and approval workflow"],
  deferred: ["Hosted plans", "Interactive browser comments"],
  risks: [{ risk: "A plan could overwrite human work.", mitigation: "Use collision-safe creation and session hash ownership." }],
  verification: ["Run node scripts/verify-harness.mjs.", "Open the generated plan at desktop and compact widths."],
  decisions: [{ decision: "Write boundary", direction: "Use publish_plan instead of generic write or edit." }],
  openQuestions: ["Should implementation begin after this plan is approved?"],
  sources: [
    { label: "Official Pi extensions", note: "Confirms custom tools and active-tool filtering.", url: "https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md" },
    { label: "Unsafe URL example", note: "Must render as text, never a clickable link.", url: "javascript:alert(1)" },
  ],
};
await assert.rejects(
  publishPlan("plan-invalid-comparison", {
    ...planFixture,
    slug: "invalid-comparison-plan",
    visuals: [{ ...planFixture.visuals[0], kind: "comparison", groups: [...planFixture.visuals[0].groups] }],
  }, undefined, undefined, publishContext),
  /Comparison visuals require exactly two groups/,
  "Plan renderer accepted a comparison visual that the tool schema rejects",
);
const firstPublication = await publishPlan("plan-create", planFixture, undefined, undefined, publishContext);
const messagesAfterPublication = sentUserMessages.length;
const failuresBeforePublishedSettlement = planContractEntries().filter((entry) => entry.data?.status === "failed").length;
await firstHandler(planArtifact, "agent_end")(completedPlanRun, publishContext);
await firstHandler(planArtifact, "agent_settled")({}, publishContext);
assert.equal(sentUserMessages.length, messagesAfterPublication, "Published Plan incorrectly triggered a retry");
assert.equal(planContractEntries().filter((entry) => entry.data?.status === "failed").length, failuresBeforePublishedSettlement, "Published headless Plan reported a contract failure");
const publishedContract = planContractEntries().at(-1)?.data;
assert.equal(publishedContract?.status, "published", "Headless Plan publication did not emit a machine-readable success state");
assert.equal(publishedContract?.path, firstPublication.details.path, "Published contract path disagrees with tool details");
for (const text of ["Approved", "What is the status?", "Hand this plan off for implementation"]) {
  await firstHandler(planArtifact, "input")({ source: "interactive", text }, publishContext);
  await firstHandler(planArtifact, "agent_settled")({}, publishContext);
}
assert.equal(sentUserMessages.length, messagesAfterPublication, "Approval, status, or handoff reply restarted the publication contract");
assert.equal(firstPublication.details.revision, false, "First Plan publication was marked as a revision");
assert.equal(path.basename(firstPublication.details.path), "plan-mode-v1-plan-2.html", "Publisher overwrote or ignored an existing human plan");
assert.equal(fs.readFileSync(existingPlan, "utf-8"), "human-owned plan", "Existing human plan was overwritten");
const firstHtml = fs.readFileSync(firstPublication.details.path, "utf-8");
assert.match(firstHtml, /Content-Security-Policy/, "Published plan lacks a restrictive CSP");
assert.match(firstHtml, /name="viewport"/, "Published plan lacks responsive viewport metadata");
assert.match(firstHtml, /@media\(max-width:620px\)/, "Published plan lacks compact layout rules");
assert.match(firstHtml, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/, "Published plan did not escape untrusted HTML text");
assert.doesNotMatch(firstHtml, /<script\b/i, "Published plan contains executable script markup");
assert.doesNotMatch(firstHtml, /href="javascript:/i, "Published plan rendered an unsafe source URL");
assert.match(firstHtml, /href="#preview"/, "Published plan lacks preview navigation");
const navHtml = firstHtml.match(/<nav aria-label="Plan sections">([\s\S]*?)<\/nav>/)?.[1] ?? "";
const navigationTargets = [...navHtml.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]);
const renderedSectionIds = [...firstHtml.matchAll(/<section id="([^"]+)"/g)].map((match) => match[1]);
assert.deepEqual(navigationTargets, renderedSectionIds, "Plan navigation does not include every rendered section in order");
const sectionNumbers = [...firstHtml.matchAll(/<section id="[^"]+"[^>]*>\s*<header><span>(\d{2}) \/ [^<]+<\/span>/g)]
  .map((match) => Number(match[1]));
assert.deepEqual(sectionNumbers, renderedSectionIds.map((_, index) => index + 1), "Plan section numbering is not continuous");
assert.match(firstHtml, /<table class="evidence"><caption>[^<]+<\/caption><thead><tr><th scope="col">Source<\/th><th scope="col">Finding<\/th>/, "Evidence table lacks captioned, scoped column headers");
assert.match(firstHtml, /a:focus-visible\{outline:3px solid var\(--focus\)/, "Plan links lack a visible keyboard-focus treatment");
assert.match(firstHtml, /nav a\{[^}]*min-height:44px/, "Plan navigation lacks practical touch targets");
assert.match(firstHtml, new RegExp(`--dim:${theme.colors.dim}`), "Plan HTML does not consume the shared dim token");
assert.match(firstHtml, new RegExp(`--error:${theme.colors.error}`), "Plan HTML does not consume the shared danger token");
assert.doesNotMatch(firstHtml, /#74787b/i, "Plan HTML retained the low-contrast legacy dim token");
assert.match(firstHtml, /class="future-preview"/, "Published plan lacks the future-state preview");
assert.match(firstHtml, /Proposed Plan review cockpit/, "Published plan lost the preview title");
assert.match(firstHtml, /&lt;img src=x onerror=alert\(1\)&gt;/, "Published plan did not escape preview content");
assert.doesNotMatch(firstHtml, /<img src=x/i, "Published plan rendered preview content as executable markup");
assert.match(firstHtml, /\.future-preview\{grid-template-columns:1fr\}/, "Published preview lacks compact layout rules");
assert.match(firstHtml, /visual-flow/, "Published plan lacks the required visual block");
assert.match(firstHtml, /flow-link/, "Published flow visual lacks connectors");
assert.match(firstHtml, /prefers-reduced-motion:reduce/, "Published plan lacks reduced-motion handling");

const revisedFixture = { ...planFixture, target: "Plan mode publishes a revised, validated local HTML artifact after research." };
await firstHandler(planArtifact, "input")({ source: "interactive", text: "Revise the target wording" }, publishContext);
await planRequest("plan-revision", { action: "revise_published" }, undefined, undefined, publishContext);
const secondPublication = await publishPlan("plan-revise", revisedFixture, undefined, undefined, publishContext);
assert.equal(secondPublication.details.path, firstPublication.details.path, "Session-owned revision created a second file");
assert.equal(secondPublication.details.revision, true, "Session-owned update was not marked as a revision");
const rejectedSecondPlan = path.join(planWorkspace, "plans", "backend-only-plan-plan.html");
for (const streamingBehavior of ["steer", "followUp"]) {
  await firstHandler(planArtifact, "input")(
    { source: "interactive", streamingBehavior, text: "Also publish a separate backend plan" },
    publishContext,
  );
  await firstHandler(planArtifact, "agent_settled")({}, publishContext);
}
assert.equal(sentUserMessages.length, messagesAfterPublication, "Steered or queued reply restarted a published Plan request");
await planRequest("plan-revision-binding", { action: "revise_published" }, undefined, undefined, publishContext);
await assert.rejects(
  publishPlan(
    "plan-second-slug",
    { ...planFixture, slug: "backend-only-plan", preview: undefined },
    undefined,
    undefined,
    publishContext,
  ),
  /already published slug "plan-mode-v1"/,
  "Publisher accepted a second slug for one interactive planning request",
);
assert.equal(fs.existsSync(rejectedSecondPlan), false, "Rejected second slug created a plan file");
await firstHandler(planArtifact, "session_start")({}, {
  ...publishContext,
  sessionManager: {
    getBranch: () => appendedEntries.map((entry) => ({ type: "custom", ...entry })),
  },
});
await assert.rejects(
  publishPlan(
    "plan-second-slug-after-restart",
    { ...planFixture, slug: "backend-only-plan", preview: undefined },
    undefined,
    undefined,
    publishContext,
  ),
  /already published slug "plan-mode-v1"/,
  "Session reload lost the active planning request's artifact binding",
);
const restartedRevision = await publishPlan("plan-revise-after-restart", revisedFixture, undefined, undefined, publishContext);
assert.equal(restartedRevision.details.path, firstPublication.details.path, "Session reload changed the same-slug revision path");
assert.equal(restartedRevision.details.revision, true, "Session reload lost same-slug revision ownership");
fs.writeFileSync(secondPublication.details.path, "external human edit", "utf-8");
await planRequest("plan-conflict-revision", { action: "revise_published" }, undefined, undefined, publishContext);
await assert.rejects(
  publishPlan("plan-conflict", revisedFixture, undefined, undefined, publishContext),
  /changed outside this session/,
  "Publisher overwrote an external edit",
);
await assert.rejects(
  publishPlan("plan-traversal", { ...planFixture, slug: "../escape" }, undefined, undefined, publishContext),
  /slug must use/,
  "Publisher accepted a traversal slug",
);

const originalArtifactPath = restartedRevision.details.path;
const originalArtifactContent = fs.readFileSync(originalArtifactPath, "utf-8");
await planRequest("plan-new-reused-slug", { action: "start_new" }, undefined, undefined, publishContext);
const reusedSlugPublication = await publishPlan(
  "plan-reused-slug",
  { ...revisedFixture, target: "A separate request may reuse a slug without overwriting the earlier artifact." },
  undefined,
  undefined,
  publishContext,
);
assert.equal(reusedSlugPublication.details.revision, false, "Separate request with a reused slug was treated as a revision");
assert.notEqual(reusedSlugPublication.details.path, originalArtifactPath, "Separate request reused the previous artifact path");
assert.equal(fs.readFileSync(originalArtifactPath, "utf-8"), originalArtifactContent, "Separate request overwrote the previous artifact");

await firstHandler(planArtifact, "input")({ source: "interactive", text: "Plan a separate backend change" }, publishContext);
await planRequest("plan-new-request", { action: "start_new" }, undefined, undefined, publishContext);
const messagesBeforeNewRequestRetry = sentUserMessages.length;
await firstHandler(planArtifact, "agent_end")(completedPlanRun, publishContext);
assert.equal(sentUserMessages.length, messagesBeforeNewRequestRetry + 1, "Separate Plan request lost the one-retry publication contract");
await firstHandler(planArtifact, "agent_end")(completedPlanRun, publishContext);
await firstHandler(planArtifact, "agent_settled")({}, publishContext);
assert.equal(sentUserMessages.length, messagesBeforeNewRequestRetry + 1, "Separate Plan request exceeded the one-retry cap");
await firstHandler(planArtifact, "session_start")({}, {
  ...publishContext,
  sessionManager: {
    getBranch: () => appendedEntries.map((entry) => ({ type: "custom", ...entry })),
  },
});
const noPreviewPublication = await publishPlan(
  "plan-no-preview",
  { ...planFixture, slug: "backend-only-plan", preview: undefined },
  undefined,
  undefined,
  publishContext,
);
const noPreviewHtml = fs.readFileSync(noPreviewPublication.details.path, "utf-8");
assert.doesNotMatch(noPreviewHtml, /href="#preview"|class="future-preview"/, "Backend-only plan rendered an omitted preview");
assert.doesNotMatch(noPreviewHtml, /preview above/, "Backend-only plan refers to a missing preview");

await firstHandler(planArtifact, "input")({ source: "interactive", text: "Plan the symlink boundary" }, publishContext);
await planRequest("plan-new-symlink-request", { action: "start_new" }, undefined, undefined, publishContext);
const symlinkWorkspace = path.join(scratchRoot, "plan-symlink-workspace");
const externalPlans = path.join(scratchRoot, "external-plans");
fs.mkdirSync(path.join(symlinkWorkspace, ".git"), { recursive: true });
fs.mkdirSync(externalPlans, { recursive: true });
fs.symlinkSync(externalPlans, path.join(symlinkWorkspace, "plans"), process.platform === "win32" ? "junction" : "dir");
await assert.rejects(
  publishPlan("plan-symlink", { ...planFixture, slug: "symlink-test" }, undefined, undefined, { ...context, cwd: symlinkWorkspace }),
  /symbolic link or junction/,
  "Publisher followed a symlinked plans directory",
);

console.log('PASS plan');

import { repoRoot, scratchRoot, assert, execFileSync, createHash, fs, path, inspectAction, isApprovalRetryEligible, GRANT_TTL_MS, consumeExactRetry, grantExactRetry, listPending, HUMAN_AWAY_SANDBOX_TOOL, assertWorkspaceHasNoLinks, state, sentUserMessages, firstHandler, widgets, ui, context, cockpitState, guardrail, guard, modes, stripAnsi, widthOf } from './harness.mjs';
await modes.commands.get("mode").handler("human-away", context);
const generatedDir = path.join(scratchRoot, 'workspace', 'dist');
fs.mkdirSync(generatedDir, {recursive:true});
const generatedFile = path.join(generatedDir, 'cache.tmp');
fs.writeFileSync(generatedFile, 'generated');
const linkedWorkspace = path.join(scratchRoot, "linked-workspace");
const linkedOutside = path.join(scratchRoot, "linked-outside");
fs.mkdirSync(linkedWorkspace, { recursive: true });
fs.mkdirSync(linkedOutside, { recursive: true });
fs.symlinkSync(linkedOutside, path.join(linkedWorkspace, "escape"), "junction");
assert.throws(() => assertWorkspaceHasNoLinks(linkedWorkspace), /refused linked workspace entry/,
  "Human Away sandbox accepted a junction escape");
const transitionFactory = widgets.get("neura-mode-transition");
assert.equal(typeof transitionFactory, "function", "Human Away transition is not animated");
const transition = transitionFactory({ requestRender() {} }, null);
for (const width of [24, 40, 80, 120]) {
  const lines = transition.render(width);
  const text = lines.map(stripAnsi).join("\n");
  assert.ok(lines.length <= 10, `Human Away animation exceeds widget cap at ${width}`);
  assert.ok(lines.every((line) => widthOf(line) <= width), `Human Away animation overflows at ${width}`);
  assert.match(text, /HUMAN AWAY.*PREVIEW|HEADMASTER/, `Human Away Preview animation identity missing at ${width}`);
  assert.doesNotMatch(text, /────/, `decorative rail remains in mode animation at ${width}`);
}
transition.dispose?.();

process.env.NEURA_HEADMASTER = "off";
assert.equal(await guard({ toolName: HUMAN_AWAY_SANDBOX_TOOL, input: { command: "node --test" } }, context), undefined,
  "Human Away blocked a known development command inside the sandbox");
assert.equal((await guard({ toolName: HUMAN_AWAY_SANDBOX_TOOL, input: { command: "printf updated > src/generated.txt" } }, context))?.block, true,
  "Human Away auto-allowed an opaque workspace edit command");
assert.equal((await guard({ toolName: HUMAN_AWAY_SANDBOX_TOOL, input: { command: "shred README.md" } }, context))?.block, true,
  "Human Away auto-allowed opaque file destruction with shred");
assert.equal((await guard({ toolName: HUMAN_AWAY_SANDBOX_TOOL, input: { command: "truncate -s 0 README.md" } }, context))?.block, true,
  "Human Away auto-allowed opaque file destruction with truncate");
assert.equal((await guard({ toolName: HUMAN_AWAY_SANDBOX_TOOL, input: { command: "git push origin main" } }, context))?.block, true,
  "Human Away sandbox bypassed remote-mutation policy");
assert.equal((await guard({ toolName: HUMAN_AWAY_SANDBOX_TOOL, input: { command: "sed -i s/a/b/ agent/neura/action-policy.ts" } }, context))?.block, true,
  "Human Away sandbox bypassed protected-control policy");
assert.equal((await guard({ toolName: HUMAN_AWAY_SANDBOX_TOOL, input: { command: "rm -r ." } }, context))?.block, true,
  "Human Away sandbox allowed recursive workspace deletion");
await firstHandler(guardrail, "agent_start")({}, context);
assert.equal(await guard({ toolName: "edit", input: { path: path.join(repoRoot, "README.md") } }, context), undefined);
const denied = await guard({ toolName: "bash", input: { command: "format C:" } }, context);
assert.equal(denied?.block, true, "Human Away broad destruction was not blocked");
assert.match(denied.reason, /Queued for Rajveer/, "Human Away denial did not queue for return");
const auditLines = fs.readFileSync(path.join(process.env.NEURA_APPROVAL_DIR, "audit.jsonl"), "utf-8").trim().split(/\r?\n/);
const queuedId = auditLines.map((line) => JSON.parse(line)).filter((event) => event.kind === "decision").at(-1).record.id;
await modes.commands.get("approvals").handler("audit", context);
assert.ok(widgets.has("neura-approvals"), "/approvals audit widget missing");
await firstHandler(modes, "input")({ source: "interactive", text: "I am back" }, context);
const approvalText = widgets.get("neura-approvals")(null, null).render(100).map(stripAnsi).join("\n");
assert.match(approvalText, new RegExp(queuedId));
assert.match(approvalText, /Neura paused at a policy boundary/, "approval request is not agent-focused");
assert.match(approvalText, /INTENT/, "approval intent missing");
assert.match(approvalText, /ACTION/, "approval exact action missing");
assert.match(approvalText, /BOUNDARY/, "approval policy boundary missing");
assert.match(approvalText, /FALLBACK/, "approval safe fallback missing");
assert.match(approvalText, /GRANT/, "approval grant scope missing");
const approvalSelections = [];
const approvalContext = {
  ...context,
  ui: {
    ...ui,
    select: async (selectionTitle, options) => {
      approvalSelections.push({ selectionTitle, options });
      return approvalSelections.length === 1 ? options[0] : undefined;
    },
  },
};
await modes.commands.get("approvals").handler("", approvalContext);
assert.equal(approvalSelections[1].options[0], "Keep denied", "approval default focus is not denial");

// Human approval creates a one-use fingerprint grant shared across isolated extensions.
process.env.NEURA_HEADMASTER = "off";
await firstHandler(guardrail, "agent_start")({}, context);
const protectedFile = path.join(path.dirname(generatedDir), ".env.production");
fs.writeFileSync(protectedFile, "PLACEHOLDER=masked\n");
const protectedContext = { ...context, cwd: path.dirname(generatedDir) };
const protectedEvent = { toolName: "read", input: { path: protectedFile } };
assert.equal((await guard(protectedEvent, protectedContext))?.block, true);
const approvalEvents = fs.readFileSync(path.join(process.env.NEURA_APPROVAL_DIR, "audit.jsonl"), "utf-8")
  .trim().split(/\r?\n/).map((line) => JSON.parse(line));
const protectedDecision = [...approvalEvents].reverse().find((event) => event.kind === "decision" && event.record.approvable);
assert.ok(protectedDecision, "approvable protected action was not queued");
await modes.commands.get("approvals").handler(`approve ${protectedDecision.record.id}`, protectedContext);
assert.equal(await guard(protectedEvent, protectedContext), undefined, "exact retry grant was not consumed across extensions");
assert.equal((await guard(protectedEvent, protectedContext))?.block, true, "exact retry grant was reusable");

const protectedAction = inspectAction(protectedEvent, protectedContext.cwd);
const stateBoundDecision = listPending(protectedContext.cwd)
  .find((record) => record.actionFingerprint === protectedAction.actionFingerprint);
assert.ok(stateBoundDecision?.approvalBindingFingerprint, "approval audit omitted state binding evidence");
const messagesBeforeStateGrant = sentUserMessages.length;
await modes.commands.get("approvals").handler(`approve ${stateBoundDecision.id}`, protectedContext);
assert.equal(sentUserMessages.length, messagesBeforeStateGrant + 1, "fresh state-bound grant was not created");
fs.appendFileSync(protectedFile, "CHANGED_AFTER_APPROVAL=1\n");
assert.equal((await guard(protectedEvent, protectedContext))?.block, true,
  "approval grant survived a relevant target content change");

const bindingWorkspace = path.join(scratchRoot, "binding-workspace");
fs.mkdirSync(path.join(bindingWorkspace, "agent"), { recursive: true });
fs.writeFileSync(path.join(bindingWorkspace, "agent", "settings.json"), "{}\n");
fs.writeFileSync(path.join(bindingWorkspace, "tracked.txt"), "one\n");
fs.writeFileSync(path.join(bindingWorkspace, ".gitignore"), "ignored.txt\n");
execFileSync("git", ["init", "--initial-branch=main"], { cwd: bindingWorkspace, windowsHide: true });
execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: bindingWorkspace, windowsHide: true });
execFileSync("git", ["config", "user.email", "neura-test@example.invalid"], { cwd: bindingWorkspace, windowsHide: true });
execFileSync("git", ["config", "user.name", "Neura Test"], { cwd: bindingWorkspace, windowsHide: true });
execFileSync("git", ["add", "."], { cwd: bindingWorkspace, windowsHide: true });
execFileSync("git", ["commit", "-m", "initial"], { cwd: bindingWorkspace, windowsHide: true });
fs.writeFileSync(path.join(bindingWorkspace, "ignored.txt"), "one\n");
const opaqueEvent = { toolName: "bash", input: { command: "custom-cli --config ignored.txt" } };
const opaqueAction = inspectAction(opaqueEvent, bindingWorkspace);
assert.equal(isApprovalRetryEligible(opaqueAction), false,
  "opaque command without a canonical target remained approval-retry eligible");
await firstHandler(guardrail, "agent_start")({}, context);
assert.equal((await guard(opaqueEvent, { ...context, cwd: bindingWorkspace }))?.block, true,
  "opaque command without a canonical target was not denied");
const opaqueDecision = listPending(bindingWorkspace)
  .find((record) => record.actionFingerprint === opaqueAction.actionFingerprint);
assert.equal(opaqueDecision?.approvable, false,
  "opaque command without a canonical target was queued as approvable");
const messagesBeforeOpaqueApproval = sentUserMessages.length;
await modes.commands.get("approvals").handler(`approve ${opaqueDecision.id}`, { ...context, cwd: bindingWorkspace });
assert.equal(sentUserMessages.length, messagesBeforeOpaqueApproval,
  "policy-denied opaque command received an exact retry grant");
fs.writeFileSync(path.join(bindingWorkspace, "ignored.txt"), "two\n");
assert.equal((await guard(opaqueEvent, { ...context, cwd: bindingWorkspace }))?.block, true,
  "opaque command bypassed denial after ignored workspace content changed");
const bindingEvent = { toolName: "edit", input: { path: path.join(bindingWorkspace, "agent", "settings.json") } };
const initialBinding = inspectAction(bindingEvent, bindingWorkspace).approvalBinding;
fs.writeFileSync(path.join(bindingWorkspace, "tracked.txt"), "two\n");
execFileSync("git", ["add", "tracked.txt"], { cwd: bindingWorkspace, windowsHide: true });
const indexedBinding = inspectAction(bindingEvent, bindingWorkspace).approvalBinding;
assert.notEqual(indexedBinding.indexFingerprint, initialBinding.indexFingerprint, "approval binding ignored index changes");
execFileSync("git", ["commit", "-m", "index change"], { cwd: bindingWorkspace, windowsHide: true });
const headBinding = inspectAction(bindingEvent, bindingWorkspace).approvalBinding;
assert.notEqual(headBinding.head, initialBinding.head, "approval binding ignored HEAD changes");
fs.writeFileSync(path.join(bindingWorkspace, "agent", "settings.json"), "{\"changed\":true}\n");
const targetBinding = inspectAction(bindingEvent, bindingWorkspace).approvalBinding;
assert.notEqual(targetBinding.targetStateFingerprint, headBinding.targetStateFingerprint,
  "approval binding ignored target content changes");
const expiringAction = inspectAction(bindingEvent, bindingWorkspace);
grantExactRetry({
  id: "expiry-test",
  createdAt: new Date(0).toISOString(),
  workspace: expiringAction.workspace,
  actionFingerprint: expiringAction.actionFingerprint,
  workspaceFingerprint: expiringAction.workspaceFingerprint,
  approvalBindingFingerprint: createHash("sha256").update(JSON.stringify(Object.fromEntries(
    Object.entries(expiringAction.approvalBinding).sort(([left], [right]) => left.localeCompare(right)),
  ))).digest("hex"),
  toolName: expiringAction.toolName,
  summary: expiringAction.summary,
  category: expiringAction.category,
  risk: expiringAction.risk,
  verdict: { decision: "defer", reason: "expiry test", saferPath: "wait", reviewer: "policy" },
  approvable: true,
  status: "pending",
}, 1_000);
assert.equal(consumeExactRetry(expiringAction, 1_000 + GRANT_TTL_MS + 1), false,
  "approval grant survived its expiry");

await firstHandler(guardrail, "agent_start")({}, context);
const syntheticSecret = "neura-test-secret-value-should-never-be-logged";
assert.equal((await guard({ toolName: "bash", input: { command: `custom-cli --token ${syntheticSecret}` } }, protectedContext))?.block, true);
assert.doesNotMatch(
  fs.readFileSync(path.join(process.env.NEURA_APPROVAL_DIR, "audit.jsonl"), "utf-8"),
  new RegExp(syntheticSecret),
  "approval audit stored a raw inline secret",
);
const approvalDirectory = process.env.NEURA_APPROVAL_DIR;
const corruptApprovalDirectory = path.join(scratchRoot, "corrupt-approvals");
fs.mkdirSync(corruptApprovalDirectory, { recursive: true });
fs.writeFileSync(path.join(corruptApprovalDirectory, "audit.jsonl"), "{}\n");
process.env.NEURA_APPROVAL_DIR = corruptApprovalDirectory;
const auditFailure = await guard({ toolName: "bash", input: { command: "custom-cli inspect" } }, protectedContext);
assert.equal(auditFailure?.block, true, "Human Away approval audit failure did not fail closed");
assert.equal(cockpitState.getCockpitState().phase, "DEGRADED", "approval audit failure was not surfaced as degraded");
process.env.NEURA_APPROVAL_DIR = approvalDirectory;
delete process.env.NEURA_HEADMASTER;

await firstHandler(guardrail, "agent_start")({}, context);
await guard({ toolName: "bash", input: { command: "format C:" } }, context);
await guard({ toolName: "bash", input: { command: "format C:" } }, context);
await guard({ toolName: "bash", input: { command: "format C:" } }, context);
assert.ok(state.aborted >= 1, "Human Away repeated-denial circuit breaker did not abort the turn");

const modePrompt = await firstHandler(modes, "before_agent_start")({ systemPrompt: "base" }, context);
assert.match(modePrompt.systemPrompt, /HUMAN AWAY/, "Human Away system contract missing");

console.log('PASS approvals');

import { createHash, randomBytes } from "node:crypto";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getMode } from "../neura/mode-state.ts";
import {
  MAX_PLAN_HTML_BYTES,
  MAX_PLAN_INPUT_BYTES,
  PLAN_ARTIFACT_ENTRY,
  PLAN_REQUEST_TOOL,
  PUBLISH_PLAN_TOOL,
  assertOwnedPlanPath,
  nextAvailablePlanPath,
  preparePlanDirectory,
} from "../neura/plan-policy.ts";
import { assertPlanDocument, renderPlanHtml } from "../neura/plan-renderer.ts";

type OwnedPlan = {
  slug: string;
  projectRoot: string;
  path: string;
  sha256: string;
};

type PromptPlanIdentity = Pick<OwnedPlan, "slug" | "projectRoot" | "path">;
type PlanLifecycle = "idle" | "planning" | "waiting" | "published";

const PLAN_REQUEST_RESET_ENTRY = "neura-plan-request-reset";
const PLAN_LIFECYCLE_ENTRY = "neura-plan-lifecycle";
const PLAN_RETRY_ENTRY = "neura-plan-publication-retry";

const Text = (description: string, minLength: number, maxLength: number) => Type.String({ description, minLength, maxLength });
const TextList = (description: string, minItems: number, maxItems: number, maxLength = 300) => Type.Array(
  Text(description, 1, maxLength),
  { minItems, maxItems },
);

const VisualGroupSchema = Type.Object({
  title: Text("short group heading", 1, 100),
  detail: Type.Optional(Text("optional explanation below the heading", 1, 240)),
  tone: Type.Optional(StringEnum(["neutral", "accent", "success", "warning", "risk"] as const)),
  items: TextList("short facts inside this visual group", 1, 8, 220),
}, { additionalProperties: false });

const PreviewRegionSchema = Type.Object({
  title: Text("visible region or responsive variant name", 1, 100),
  detail: Type.Optional(Text("what this region communicates or enables", 1, 240)),
  tone: Type.Optional(StringEnum(["neutral", "accent", "success", "warning", "risk"] as const)),
  items: TextList("representative UI copy, controls, states, or layout notes", 1, 8, 220),
}, { additionalProperties: false });

const VisualSchema = (kind: "flow" | "comparison" | "boundary", minItems: number, maxItems: number) => Type.Object({
  kind: Type.Literal(kind),
  title: Text("what relationship this visual explains", 3, 120),
  caption: Type.Optional(Text("short takeaway from this visual", 3, 300)),
  groups: Type.Array(VisualGroupSchema, { minItems, maxItems }),
}, { additionalProperties: false });

const PlanSchema = Type.Object({
  slug: Type.String({
    description: "stable lowercase filename slug, without path or extension",
    minLength: 2,
    maxLength: 80,
    pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
  }),
  title: Text("plain-English plan title", 4, 160),
  brief: Text("what is being planned, why it matters, and the intended outcome", 20, 600),
  current: Text("current state in simple English", 10, 500),
  target: Text("planned state in simple English", 10, 500),
  done: Text("observable definition of done", 10, 500),
  evidence: Type.Array(Type.Object({
    source: Text("real file, symbol, command, document, or external source", 1, 240),
    finding: Text("fact learned from that source", 5, 500),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 12 }),
  preview: Type.Optional(Type.Object({
    title: Text("future-state surface being previewed", 3, 120),
    caption: Type.Optional(Text("directional fidelity note or key takeaway", 3, 300)),
    regions: Type.Array(PreviewRegionSchema, { minItems: 1, maxItems: 8 }),
  }, { additionalProperties: false })),
  visuals: Type.Array(Type.Union([
    VisualSchema("flow", 2, 8),
    VisualSchema("comparison", 2, 2),
    VisualSchema("boundary", 2, 4),
  ]), { minItems: 1, maxItems: 3 }),
  steps: Type.Array(Type.Object({
    title: Text("step name", 2, 120),
    what: Text("specific change to make", 5, 500),
    why: Text("reason for this change", 5, 400),
    files: TextList("real file path or implementation surface", 1, 8, 240),
    proof: Text("check that proves this step works", 5, 400),
  }, { additionalProperties: false }), { minItems: 2, maxItems: 8 }),
  included: TextList("work included in this version", 1, 12),
  deferred: TextList("work explicitly delayed", 1, 12),
  risks: Type.Array(Type.Object({
    risk: Text("failure or regression risk", 3, 300),
    mitigation: Text("specific control or fallback", 3, 400),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 10 }),
  verification: TextList("automated or end-to-end verification step", 2, 12, 400),
  decisions: Type.Optional(Type.Array(Type.Object({
    decision: Text("decision name", 2, 180),
    direction: Text("chosen direction and rationale", 3, 500),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 10 })),
  openQuestions: Type.Optional(TextList("question that materially changes scope or architecture", 1, 6, 400)),
  sources: Type.Array(Type.Object({
    label: Text("human-readable source label", 2, 240),
    note: Text("how this source informed the plan", 3, 500),
    url: Type.Optional(Text("optional public HTTP or HTTPS source URL", 8, 2_048)),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 12 }),
}, { additionalProperties: false });

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function ownershipKey(projectRoot: string, slug: string): string {
  return `${projectRoot}\0${slug}`;
}

function isOwnedPlan(value: unknown): value is OwnedPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return [record.slug, record.projectRoot, record.path, record.sha256].every((item) => typeof item === "string");
}

function isPlanLifecycle(value: unknown): value is { state: Exclude<PlanLifecycle, "idle" | "published">; resetRetry?: boolean } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (record.state === "planning" || record.state === "waiting")
    && (record.resetRetry === undefined || typeof record.resetRetry === "boolean");
}

function aborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Plan publication aborted.");
}

async function writeNewPlan(destination: string, html: string): Promise<void> {
  await fsp.writeFile(destination, html, { encoding: "utf-8", flag: "wx" });
}

async function replaceOwnedPlan(destination: string, html: string, expectedHash: string): Promise<void> {
  const current = await fsp.readFile(destination, "utf-8");
  if (sha256(current) !== expectedHash) {
    throw new Error("Plan changed outside this session. Refusing to overwrite human or external edits.");
  }
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${randomBytes(8).toString("hex")}.tmp`);
  await fsp.writeFile(temporary, html, { encoding: "utf-8", flag: "wx" });
  try {
    await fsp.rename(temporary, destination);
  } finally {
    await fsp.rm(temporary, { force: true }).catch(() => {});
  }
}

export default function (pi): void {
  if (!process.env.NEURA) return;

  const ownedPlans = new Map<string, OwnedPlan>();
  let planForPrompt: PromptPlanIdentity | undefined;
  let lifecycle: PlanLifecycle = "idle";
  let publicationRetries = 0;

  function persistLifecycle(state: "planning" | "waiting", resetRetry = false): void {
    try { pi.appendEntry(PLAN_LIFECYCLE_ENTRY, resetRetry ? { state, resetRetry: true } : { state }); }
    catch {}
  }

  function startNewRequest(): void {
    planForPrompt = undefined;
    lifecycle = "planning";
    publicationRetries = 0;
    try { pi.appendEntry(PLAN_REQUEST_RESET_ENTRY); }
    catch {}
  }

  pi.registerTool({
    name: PLAN_REQUEST_TOOL,
    label: "Plan request lifecycle",
    description:
      "Record an explicit Plan request transition. Use wait_for_input before ending with a material clarification question, " +
      "revise_published before updating the active published artifact, or start_new before planning a separate objective. " +
      "Do not call this tool for approval, status, or handoff replies after publication.",
    promptSnippet: "Mark a Plan request as waiting, revising, or new",
    promptGuidelines: [
      "Use wait_for_input only when a material answer is required before a safe plan can be published.",
      "Use revise_published only for a requested change to the active artifact; retain its slug.",
      "Use start_new only for a separate planning objective after the current request is published or abandoned.",
    ],
    parameters: Type.Object({
      action: StringEnum(["wait_for_input", "revise_published", "start_new"] as const),
    }, { additionalProperties: false }),
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      if (getMode() !== "plan") throw new Error("plan_request is available only while Neura Plan mode is active.");
      if (params.action === "start_new") {
        startNewRequest();
        return { content: [{ type: "text", text: "Started a separate planning request. Publish one artifact for this request." }] };
      }
      if (params.action === "revise_published") {
        if (!planForPrompt || lifecycle !== "published") {
          throw new Error("No published plan is active. Use start_new for a separate planning request.");
        }
        lifecycle = "planning";
        publicationRetries = 0;
        persistLifecycle("planning", true);
        return { content: [{ type: "text", text: `Revision opened for slug "${planForPrompt.slug}". Publish the update with that same slug.` }] };
      }
      if (lifecycle !== "planning") {
        throw new Error("No planning request is active. Use start_new before waiting for input on a separate request.");
      }
      lifecycle = "waiting";
      persistLifecycle("waiting");
      return { content: [{ type: "text", text: "Planning request is waiting for material user input. Ask the question and stop; no publication retry will run." }] };
    },
  });

  pi.registerTool({
    name: PUBLISH_PLAN_TOOL,
    label: "Publish plan",
    description:
      "Publish the researched implementation plan as safe, self-contained HTML inside the current project's plans folder. " +
      "Use only after inspecting relevant code and documentation. Include at least one meaningful visual and realistic verification. " +
      "When work changes a visible surface, include a directional future-state preview. " +
      "Each planning request may publish one artifact; open requested revisions with plan_request and retain the same slug.",
    promptSnippet: "Publish a structured visual HTML plan to the local project plans folder",
    promptGuidelines: [
      "Use publish_plan only in Neura Plan mode, after completing the evidence pass.",
      "Publish one artifact per planning request. Use plan_request before a requested revision, then retain the same slug.",
      "For visible product work, include preview with representative regions, copy, controls, states, and responsive variants; omit it for invisible backend work rather than inventing UI.",
      "Use simple English in publish_plan fields; name real files and checks; stop for human approval after publication.",
    ],
    parameters: PlanSchema,
    executionMode: "sequential",
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (getMode() !== "plan") throw new Error("publish_plan is available only while Neura Plan mode is active.");
      if (lifecycle !== "planning") {
        throw new Error("No planning publication is active. Use plan_request before revising a published artifact or starting a separate plan.");
      }
      aborted(signal);
      assertPlanDocument(params);
      if (planForPrompt && params.slug !== planForPrompt.slug) {
        throw new Error(`This planning request already published slug "${planForPrompt.slug}". Revise it with the same slug or use plan_request start_new for a separate objective.`);
      }
      if (Buffer.byteLength(JSON.stringify(params), "utf-8") > MAX_PLAN_INPUT_BYTES) {
        throw new Error("Plan input exceeds the 256 KiB structured-data limit.");
      }

      const html = renderPlanHtml(params);
      const htmlBytes = Buffer.byteLength(html, "utf-8");
      if (htmlBytes > MAX_PLAN_HTML_BYTES) throw new Error("Rendered plan exceeds the 512 KiB HTML limit.");
      const nextHash = sha256(html);
      const { projectRoot, plansDir } = await preparePlanDirectory(ctx.cwd);
      if (planForPrompt && projectRoot !== planForPrompt.projectRoot) {
        throw new Error("This planning request already published an artifact in another project. Revise that artifact or use plan_request start_new for a separate objective.");
      }
      const key = ownershipKey(projectRoot, params.slug);
      const owned = planForPrompt ? ownedPlans.get(key) : undefined;
      let destination = owned?.path;
      let revision = false;

      if (owned) {
        await assertOwnedPlanPath(plansDir, owned.path);
        destination = owned.path;
        revision = true;
        await withFileMutationQueue(destination, async () => {
          aborted(signal);
          await assertOwnedPlanPath(plansDir, destination!);
          await replaceOwnedPlan(destination!, html, owned.sha256);
        });
      } else {
        let created = false;
        for (let attempt = 0; attempt < 3 && !created; attempt++) {
          destination = await nextAvailablePlanPath(plansDir, params.slug);
          try {
            await withFileMutationQueue(destination, async () => {
              aborted(signal);
              await writeNewPlan(destination!, html);
            });
            created = true;
          } catch (error) {
            const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
            if (code !== "EEXIST") throw error;
          }
        }
        if (!created || !destination) throw new Error("Plan destination changed repeatedly. Retry with a more specific slug.");
      }

      const ownership: OwnedPlan = { slug: params.slug, projectRoot, path: destination!, sha256: nextHash };
      ownedPlans.set(key, ownership);
      planForPrompt = ownership;
      lifecycle = "published";
      publicationRetries = 0;
      let persisted = true;
      try { pi.appendEntry(PLAN_ARTIFACT_ENTRY, ownership); }
      catch { persisted = false; }
      const relative = path.relative(projectRoot, destination!);
      return {
        content: [{
          type: "text",
          text: `${revision ? "Revised" : "Created"} ${relative}\nSHA-256 ${nextHash}\nStop and ask Rajveer to review this plan before implementation.`,
        }],
        details: { ...ownership, relativePath: relative, bytes: htmlBytes, revision, ownershipPersisted: persisted },
      };
    },
  });

  pi.on("session_start", (_event, ctx) => {
    ownedPlans.clear();
    planForPrompt = undefined;
    lifecycle = "idle";
    publicationRetries = 0;
    let entries: Array<{ type?: string; customType?: string; data?: unknown }> = [];
    try { entries = ctx.sessionManager.getBranch?.() ?? ctx.sessionManager.getEntries?.() ?? []; }
    catch { return; }
    for (const entry of entries) {
      if (entry.type === "custom" && entry.customType === PLAN_REQUEST_RESET_ENTRY) {
        planForPrompt = undefined;
        lifecycle = "planning";
        publicationRetries = 0;
        continue;
      }
      if (entry.type === "custom" && entry.customType === PLAN_LIFECYCLE_ENTRY && isPlanLifecycle(entry.data)) {
        lifecycle = entry.data.state;
        if (entry.data.resetRetry) publicationRetries = 0;
        continue;
      }
      if (entry.type === "custom" && entry.customType === PLAN_RETRY_ENTRY) {
        publicationRetries = 1;
        continue;
      }
      if (entry.type !== "custom" || entry.customType !== PLAN_ARTIFACT_ENTRY || !isOwnedPlan(entry.data)) continue;
      ownedPlans.set(ownershipKey(entry.data.projectRoot, entry.data.slug), entry.data);
      planForPrompt = entry.data;
      lifecycle = "published";
      publicationRetries = 0;
    }
  });

  pi.on("input", (event) => {
    if (event.source !== "interactive" || getMode() !== "plan") return;
    if (lifecycle === "idle") {
      startNewRequest();
      return;
    }
    if (lifecycle === "waiting") {
      lifecycle = "planning";
      persistLifecycle("planning");
    }
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (getMode() !== "plan" || lifecycle !== "planning") return;
    if (publicationRetries < 1 && ctx.hasUI) {
      publicationRetries++;
      try { pi.appendEntry(PLAN_RETRY_ENTRY); }
      catch {}
      pi.sendUserMessage(
        "[PLAN CONTRACT RETRY] No HTML plan was published for the active request. Complete any missing evidence, call publish_plan, return its local path, and stop for approval. Do not implement source changes.",
        { deliverAs: "followUp" },
      );
      return;
    }
    try { ctx.ui.notify("Plan mode ended without an HTML artifact. No source changes were allowed.", "warning"); }
    catch {}
  });
}

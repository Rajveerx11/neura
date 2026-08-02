// Transcript copy actions. Pi owns core message rendering, so Neura adds a
// keyboard-first action rail and selector without patching global node_modules.

import { copyToClipboard } from "@earendil-works/pi-coding-agent";
import { getCockpitState, patchCockpit } from "../neura/cockpit-state.ts";
import { MOTION } from "../neura/ui-tokens.ts";

export type CopySection = {
  kind: "answer" | "code";
  label: string;
  text: string;
  language?: string;
  path?: string;
};

export function assistantText(message: any): string {
  if (!message || message.role !== "assistant") return "";
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

function oneLine(value: string, limit = 42): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

export function parseCopySections(markdown: string): CopySection[] {
  const value = String(markdown ?? "").trim();
  if (!value) return [];
  const sections: CopySection[] = [{ kind: "answer", label: `Answer · ${value.length} chars`, text: value }];
  const fence = /```([^\n`]*)\r?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = fence.exec(value)) !== null) {
    const info = match[1].trim().split(/\s+/).filter(Boolean);
    const language = info[0] || "text";
    const path = info.find((item, itemIndex) => itemIndex > 0 && /[\\/.]/.test(item));
    const text = match[2].replace(/\r?\n$/, "");
    index++;
    const firstLine = oneLine(text.split(/\r?\n/).find((line) => line.trim()) || "empty block");
    sections.push({
      kind: "code",
      label: `Code ${index} · ${language}${path ? ` · ${path}` : ""} · ${firstLine}`,
      text,
      language,
      path,
    });
  }
  return sections;
}

export function latestAssistantText(ctx): string {
  try {
    const branch = ctx.sessionManager.getBranch();
    for (let index = branch.length - 1; index >= 0; index--) {
      const text = assistantText(branch[index]?.message ?? branch[index]);
      if (text) return text;
    }
  } catch {}
  return "";
}

export default function (pi) {
  if (!process.env.NEURA) return;

  let lastText = "";
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;

  function publishAvailability(): CopySection[] {
    const sections = parseCopySections(lastText);
    patchCockpit({ copy: { available: sections.length > 0, codeBlocks: sections.filter((item) => item.kind === "code").length } });
    return sections;
  }

  async function copySection(section: CopySection, ctx): Promise<void> {
    try {
      await copyToClipboard(section.text);
      const message = section.kind === "answer" ? "copied answer" : "copied code block";
      const current = getCockpitState();
      patchCockpit({ copy: { ...current.copy, feedback: message } });
      ctx.ui.notify(`✓ ${message}`);
      if (feedbackTimer) clearTimeout(feedbackTimer);
      feedbackTimer = setTimeout(() => {
        const next = getCockpitState();
        patchCockpit({ copy: { ...next.copy, feedback: undefined } });
      }, MOTION.copyFeedbackMs);
      feedbackTimer.unref?.();
    } catch {
      ctx.ui.notify("Clipboard unavailable. Use terminal selection, or Ctrl+X for Pi's whole-message copy.", "error");
    }
  }

  async function chooseSection(ctx, codeOnly = false): Promise<void> {
    if (!lastText) lastText = latestAssistantText(ctx);
    const sections = publishAvailability().filter((item) => !codeOnly || item.kind === "code");
    if (!sections.length) {
      ctx.ui.notify(codeOnly ? "No fenced code blocks in the latest Neura response." : "No Neura response is available to copy.", "warning");
      return;
    }
    const labels = sections.map((section, index) => `${index + 1}. ${section.label}`);
    const selected = await ctx.ui.select("Copy from latest Neura response", [...labels, "Close"]);
    if (!selected || selected === "Close") return;
    const index = Number.parseInt(selected.split(".", 1)[0], 10) - 1;
    if (sections[index]) await copySection(sections[index], ctx);
  }

  pi.registerShortcut("ctrl+shift+x", {
    description: "Choose a code block from the latest Neura response",
    handler: async (ctx) => chooseSection(ctx, true),
  });

  pi.registerCommand("clip", {
    description: "Copy the latest Neura answer or a fenced code block: /clip [answer|code]",
    handler: async (args, ctx) => {
      const target = String(args ?? "").trim().toLowerCase();
      if (!lastText) lastText = latestAssistantText(ctx);
      const sections = publishAvailability();
      if (target === "answer") {
        const answer = sections.find((item) => item.kind === "answer");
        if (!answer) return void ctx.ui.notify("No Neura response is available to copy.", "warning");
        return copySection(answer, ctx);
      }
      if (target === "code") return chooseSection(ctx, true);
      if (target) return void ctx.ui.notify("usage: /clip [answer|code]", "warning");
      return chooseSection(ctx);
    },
  });

  pi.on("session_start", (_event, ctx) => {
    lastText = latestAssistantText(ctx);
    publishAvailability();
  });

  pi.on("message_end", (event) => {
    const text = assistantText(event.message);
    if (!text) return;
    lastText = text;
    publishAvailability();
  });

  pi.on("session_shutdown", () => { if (feedbackTimer) clearTimeout(feedbackTimer); });
}

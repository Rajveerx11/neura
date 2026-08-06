// Gmail guardrail — current human approval for outbound and irreversible actions.

import { getMode } from "../neura/mode-state.ts";

const CONFIRM: Record<string, string> = {
  GMAIL_SEND_EMAIL: "send an email",
  GMAIL_SEND_DRAFT: "send a draft",
  GMAIL_REPLY_TO_THREAD: "send a reply",
  GMAIL_FORWARD_MESSAGE: "forward an email",
  GMAIL_BATCH_DELETE_MESSAGES: "permanently delete multiple emails",
  GMAIL_DELETE_DRAFT: "permanently delete a draft",
  GMAIL_DELETE_LABEL: "permanently delete a label",
  GMAIL_DELETE_MESSAGE: "permanently delete an email",
  GMAIL_DELETE_THREAD: "permanently delete a thread",
  GMAIL_REMOVE_LABEL: "remove a label from an email",
  GMAIL_CREATE_FILTER: "create an automatic Gmail filter",
  GMAIL_DELETE_FILTER: "delete a Gmail filter",
  GMAIL_PATCH_SEND_AS: "change a Gmail send-as identity",
  GMAIL_UPDATE_DRAFT: "replace an existing draft",
  GMAIL_IMPORT_MESSAGE: "import a message into the mailbox",
  GMAIL_INSERT_MESSAGE: "insert a message into the mailbox",
  GMAIL_UPDATE_IMAP_SETTINGS: "change Gmail IMAP access settings",
  GMAIL_UPDATE_POP_SETTINGS: "change Gmail POP access settings",
  GMAIL_UPDATE_SEND_AS: "change a Gmail send-as identity",
  GMAIL_UPDATE_VACATION_SETTINGS: "change automatic vacation replies",
};

function summarize(input: Record<string, unknown> | undefined): string {
  if (!input) return "No action details supplied.";
  const useful = [
    "to", "recipient", "recipients", "recipient_email", "cc", "bcc", "subject",
    "id", "message_id", "message_ids", "messageIds", "thread_id", "draft_id", "filter_id",
    "criteria", "action", "send_as_email", "response_subject", "enable_auto_reply",
    "sendAsEmail", "responseSubject", "enableAutoReply", "startTime", "endTime",
  ];
  const lines = useful
    .filter((key) => input[key] !== undefined)
    .map((key) => `${key}: ${JSON.stringify(input[key]).slice(0, 180)}`);
  return lines.length ? lines.join("\n") : "Review the Gmail tool arguments before allowing this action.";
}

export default function (pi) {
  if (!process.env.NEURA) return;

  pi.on("tool_call", async (event, ctx) => {
    const prefix = "mcp__gmail__";
    if (!event.toolName.startsWith(prefix)) return;
    if (getMode() === "yolo") return;

    const action = event.toolName.slice(prefix.length).toUpperCase();
    const description = CONFIRM[action];
    if (!description) return;

    if (!ctx.hasUI) {
      return {
        block: true,
        reason: `Gmail guardrail blocked ${action}: interactive approval is required.`,
      };
    }

    const approved = await ctx.ui.confirm(
      "Gmail confirmation",
      `Neura wants to ${description}.\n\n${summarize(event.input)}\n\nAllow?`,
    );
    if (!approved) {
      return { block: true, reason: `Gmail guardrail denied ${action}.` };
    }
  });
}

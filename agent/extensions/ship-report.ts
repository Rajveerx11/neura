// ship-report — injects Rajveer's end-of-iteration report format into every turn's system prompt.
// Delete file to unwire.

const REPORT_RULES = `

## End-of-iteration report (standing user preference)
When a work iteration completes (a batch of tasks done — not every tool call), close your reply with a SHORT report:
1. **What I did** — concise bullets, simple language.
2. **Why** — one short line per item (reasoning/benefit).
3. **Do this now** — numbered manual steps the user must do by hand (omit if none).
4. **Key takeaway** — ONE lesson so the user learns while doing.
Keep it short: proper headings, tight bullets, no walls of text.`;

export default function (pi) {
  pi.on("before_agent_start", (event) => {
    return { systemPrompt: event.systemPrompt + REPORT_RULES };
  });
}

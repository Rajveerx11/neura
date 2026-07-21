// guardrail — block-and-ask on destructive commands, confirm on secret-file reads.
// Pi ships with no permission system; this is it. Delete file to unwire.

const DESTRUCTIVE = [
  { re: /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)[a-z]*\b/i, why: "recursive force delete (rm -rf)" },
  { re: /\bgit\s+push\s+.*(--force\b|-f\b)/i, why: "git force push" },
  { re: /\bgit\s+reset\s+--hard\b/i, why: "git reset --hard (discards local changes)" },
  { re: /\bgit\s+clean\s+-[a-z]*f/i, why: "git clean -f (deletes untracked files)" },
  { re: /\bdrop\s+(table|database|schema)\b/i, why: "SQL DROP" },
  { re: /\btruncate\s+table\b/i, why: "SQL TRUNCATE" },
  { re: /remove-item\s+(?=[^\n]*-recurse)[^\n]*-force|remove-item\s+(?=[^\n]*-force)[^\n]*-recurse/i, why: "recursive force delete (Remove-Item)" },
  { re: /\b(rmdir|rd)\s+\/s\b|\bdel\s+\/[sf]\b/i, why: "recursive delete (cmd)" },
  { re: /\bmkfs\b|\bformat\s+[a-z]:\b/i, why: "disk format" },
];

const SECRET_FILES = /\.env(\.[a-z]+)?$|id_rsa|id_ed25519|\.pem$|\.key$|auth\.json$|credentials/i;

export default function (pi) {
  pi.on("tool_call", async (event, ctx) => {
    // Destructive shell commands: block-and-ask
    if (event.toolName === "bash") {
      const cmd = String(event.input?.command ?? "");
      for (const { re, why } of DESTRUCTIVE) {
        if (re.test(cmd)) {
          const ok = await ctx.ui.confirm(
            "Destructive command",
            `${why}\n\n${cmd.slice(0, 300)}\n\nAllow?`
          );
          if (!ok) return { block: true, reason: `Blocked by guardrail: ${why}. User denied.` };
          return; // one confirm is enough
        }
      }
      // Secret file access via shell (cat .env etc.)
      if (SECRET_FILES.test(cmd)) {
        const ok = await ctx.ui.confirm("Secret file access", `Command touches a secret-looking file:\n\n${cmd.slice(0, 300)}\n\nAllow?`);
        if (!ok) return { block: true, reason: "Blocked by guardrail: secret file access denied." };
      }
      return;
    }

    // Direct reads of secret files
    if (event.toolName === "read") {
      const p = String(event.input?.path ?? event.input?.file_path ?? "");
      if (SECRET_FILES.test(p)) {
        const ok = await ctx.ui.confirm("Secret file read", `Model wants to read:\n${p}\n\nAllow?`);
        if (!ok) return { block: true, reason: "Blocked by guardrail: secret file read denied." };
      }
    }
  });
}

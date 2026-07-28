// guardrail — block-and-ask on destructive commands, confirm on secret-file reads.
// Pi ships with no permission system; this is it. Delete file to unwire.

const DESTRUCTIVE = [
  { re: /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)[a-z]*\b/i, why: "recursive force delete (rm -rf)" },
  { re: /\bgit\s+push\s+.*(--force\b|-f\b)/i, why: "git force push" },
  { re: /\bgit\s+reset\s+--hard\b/i, why: "git reset --hard (discards local changes)" },
  { re: /\bgit\s+clean\s+-[a-z]*f/i, why: "git clean -f (deletes untracked files)" },
  { re: /\bgit\s+(?:checkout\s+--|restore\s+(?:--worktree\s+)?(?:\.|--source)|branch\s+-D\b|push\s+.*--delete\b)/i, why: "destructive git operation" },
  { re: /\bdrop\s+(table|database|schema)\b/i, why: "SQL DROP" },
  { re: /\btruncate\s+table\b/i, why: "SQL TRUNCATE" },
  { re: /remove-item\s+(?=[^\n]*-recurse)[^\n]*-force|remove-item\s+(?=[^\n]*-force)[^\n]*-recurse/i, why: "recursive force delete (Remove-Item)" },
  { re: /\b(rmdir|rd)\s+\/s\b|\bdel\s+\/[sf]\b/i, why: "recursive delete (cmd)" },
  { re: /\bmkfs\b|\bformat\s+[a-z]:\b/i, why: "disk format" },
  { re: /\bterraform\s+(?:apply\s+.*-auto-approve|destroy)\b/i, why: "unattended infrastructure mutation" },
  { re: /\bkubectl\s+delete\s+(?:namespace|ns)\b/i, why: "Kubernetes namespace deletion" },
  { re: /\bdocker\s+system\s+prune\b/i, why: "Docker system prune" },
];

const SECRET_FILES =
  /(?:^|[\\/\s"'=])(?:\.env(?:\.[\w.-]+)?|id_rsa|id_ed25519|[\w.-]+\.(?:pem|key)|auth\.json|credentials(?:\.[\w.-]+)?)(?=$|[\\/\s"'`;|&])/i;

export default function (pi) {
  if (!process.env.NEURA) return; // plain `pi` stays stock

  pi.on("tool_call", async (event, ctx) => {
    const approve = async (title: string, message: string) => {
      if (!ctx.hasUI) return false;
      return ctx.ui.confirm(title, message);
    };

    // Destructive shell commands: block-and-ask
    if (event.toolName === "bash") {
      const cmd = String(event.input?.command ?? "");
      for (const { re, why } of DESTRUCTIVE) {
        if (re.test(cmd)) {
          const ok = await approve(
            "Destructive command",
            `${why}\n\n${cmd.slice(0, 300)}\n\nAllow?`
          );
          if (!ok) return { block: true, reason: `Blocked by guardrail: ${why}. Approval unavailable or denied.` };
          return; // one confirm is enough
        }
      }
      // Secret file access via shell (cat .env etc.)
      if (SECRET_FILES.test(cmd)) {
        const ok = await approve("Secret file access", `Command touches a secret-looking file:\n\n${cmd.slice(0, 300)}\n\nAllow?`);
        if (!ok) return { block: true, reason: "Blocked by guardrail: secret file access approval unavailable or denied." };
      }
      return;
    }

    // Direct reads of secret files
    if (event.toolName === "read" || event.toolName === "write" || event.toolName === "edit") {
      const p = String(event.input?.path ?? event.input?.file_path ?? "");
      if (SECRET_FILES.test(p)) {
        const mutation = event.toolName !== "read";
        const ok = await approve(
          mutation ? "Secret file modification" : "Secret file read",
          `Model wants to ${mutation ? "modify" : "read"}:\n${p}\n\nAllow?`,
        );
        if (!ok) return { block: true, reason: `Blocked by guardrail: secret file ${mutation ? "modification" : "read"} approval unavailable or denied.` };
      }
    }
  });
}

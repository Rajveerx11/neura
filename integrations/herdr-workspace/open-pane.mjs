import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function paneArgs(entrypoint, env = process.env) {
  if (!new Set(["notes", "calendar"]).has(entrypoint)) throw new Error("Invalid pane entrypoint.");
  let context = {};
  try { context = JSON.parse(env.HERDR_PLUGIN_CONTEXT_JSON || "{}"); } catch {}
  const targetPane = env.HERDR_PANE_ID || context.pane_id || context.pane?.pane_id || context.focused_pane_id || context.focused_pane?.pane_id;
  const workspace = env.HERDR_WORKSPACE_ID || context.workspace_id || context.workspace?.workspace_id;
  const args = ["plugin", "pane", "open", "--plugin", "neura.workspace", "--entrypoint", entrypoint, "--placement", "split", "--direction", "right", "--focus"];
  if (targetPane) args.push("--target-pane", String(targetPane));
  else if (workspace) args.push("--workspace", String(workspace));
  return args;
}

export function launchPane(entrypoint, env = process.env, spawn = spawnSync) {
  const result = spawn(env.HERDR_BIN_PATH || "herdr", paneArgs(entrypoint, env), { stdio: "inherit", windowsHide: true });
  return result.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exit(launchPane(process.argv[2])); } catch { process.exit(2); }
}

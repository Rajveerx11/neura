import { getSelectListTheme, type ExtensionAPI, type ExtensionContext, type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
import { Input, SelectList, truncateToWidth, type TUI } from "@earendil-works/pi-tui";
import { getMode, isHostOperationActive, isModeRestorePending, MODES, modeLabel, type AgentMode } from "./mode-state.ts";
import { getCockpitState } from "./cockpit-state.ts";
import { redactSensitiveText } from "./redaction.ts";

export const LAUNCHER_SHORTCUT = "ctrl+shift+k";
type PublicCommand = ReturnType<ExtensionAPI["getCommands"]>[number];
export type LauncherAction = {
  id: string;
  name: string;
  source: PublicCommand["source"];
  command: string;
  description: string;
  mode?: AgentMode;
  shortcut?: string;
  disabled?: string;
};

// Only public metadata, never source paths, argument history, or integration state.
const cleanDescription = (text: string) => redactSensitiveText(text).replace(/[\x00-\x1f\x7f-\x9f]/g, " ");

export function launcherActions(commands: PublicCommand[], idle: boolean): LauncherAction[] {
  const current = getMode();
  const blocked = isModeRestorePending() ? "Previous session is draining."
    : isHostOperationActive() ? "A host operation is running."
    : !idle ? "Finish or abort the active turn first." : undefined;
  const actions: LauncherAction[] = [];
  for (const entry of commands) {
    // A selection must be one registry command, not embedded arguments or input.
    if (!/^[a-zA-Z0-9_.:-]+$/.test(entry.name)) continue;
    const extension = entry.source === "extension";
    let disabled = blocked ?? (extension && entry.name === "launcher" ? "Launcher is already open." : undefined);
    if (!disabled && extension) {
      if (["health", "undo", "mcp", "remember", "memory"].includes(entry.name) && current !== "yolo") disabled = "Requires YOLO; unavailable in this mode.";
      if (entry.name === "ship" && !["work", "yolo"].includes(current)) disabled = "Verification requires Work or YOLO.";
      if (entry.name === "learn" && current !== "learn") disabled = "Requires Learn mode.";
    }
    const base: LauncherAction = {
      id: `${entry.source}:${entry.name}`, name: entry.name, source: entry.source,
      command: `/${entry.name}`, description: cleanDescription(entry.description ?? ""), disabled,
      shortcut: extension && entry.name === "launcher" ? LAUNCHER_SHORTCUT : extension && entry.name === "mode" ? "shift+tab"
        : extension && entry.name === "clip" && getCockpitState().copy.codeBlocks > 0 ? "ctrl+shift+x" : undefined,
    };
    actions.push(base);
    if (extension && entry.name === "mode") {
      for (const mode of MODES) actions.push({
        ...base, id: `${base.id}:${mode}`, mode, command: `/mode ${mode}`,
        description: `${modeLabel(mode)}${current === mode ? " · active" : ""}`,
      });
    }
  }
  return actions;
}

export function searchLauncher(actions: LauncherAction[], query: string): LauncherAction[] {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return actions.filter((action) => words.every((word) =>
    `${action.command} ${action.description} ${action.mode ?? ""} ${action.shortcut ?? ""} ${action.source}`.toLowerCase().includes(word)))
    .sort((a, b) => Number(words.every((word) => b.command.toLowerCase().includes(word)))
      - Number(words.every((word) => a.command.toLowerCase().includes(word))));
}

// Native Input owns editing/IME; native SelectList owns selection and scrolling.
// No animation or timers: reduced-motion behavior is the default.
export class CommandLauncher {
  private input = new Input({ prompt: "Search: " });
  private list: SelectList;
  private actions: LauncherAction[] = [];
  private snapshot = "";
  private query = "";
  private completed = false;
  get focused() { return this.input.focused; }
  set focused(value: boolean) { this.input.focused = value; }

  private tui: TUI;
  private theme: Theme;
  private keys: KeybindingsManager;
  private readActions: () => LauncherAction[];
  private done: (action: LauncherAction | undefined) => void;

  constructor(tui: TUI, theme: Theme, keys: KeybindingsManager,
    readActions: () => LauncherAction[], done: (action: LauncherAction | undefined) => void) {
    this.tui = tui;
    this.theme = theme;
    this.keys = keys;
    this.readActions = readActions;
    this.done = done;
    this.list = new SelectList([], 4, getSelectListTheme());
    this.input.onSubmit = () => this.select();
    this.input.onEscape = () => this.finish(undefined);
    this.refresh();
  }

  private finish(action: LauncherAction | undefined) {
    if (this.completed) return;
    this.completed = true;
    this.done(action);
  }

  private refresh() {
    const query = this.input.getValue();
    const selected = query === this.query ? this.list.getSelectedItem()?.value : undefined;
    this.query = query;
    const actions = searchLauncher(this.readActions(), query);
    const snapshot = JSON.stringify(actions);
    if (snapshot === this.snapshot) return;
    this.snapshot = snapshot;
    this.actions = actions;
    this.list = new SelectList(actions.map((action) => ({
      value: action.id, label: `${action.command}${action.disabled ? " [disabled]" : ""}`,
      description: action.description,
    })), 4, getSelectListTheme());
    const index = actions.findIndex((action) => action.id === selected);
    if (index >= 0) this.list.setSelectedIndex(index);
  }

  private select() {
    // Re-read both registry and mode at selection, including stale open screens.
    const previous = this.list.getSelectedItem()?.value;
    this.refresh();
    const action = this.actions.find((item) => item.id === this.list.getSelectedItem()?.value);
    if (action && action.id === previous && !action.disabled) this.finish(action);
  }

  handleInput(data: string) {
    if (this.completed) return;
    if (this.keys.matches(data, "tui.select.cancel")) this.finish(undefined);
    else if (this.keys.matches(data, "tui.select.confirm")) this.select();
    else if (this.keys.matches(data, "tui.select.pageUp") || this.keys.matches(data, "tui.select.pageDown")) {
      // Pi 1.0.4 SelectList handles arrows, but not its page actions.
      const index = this.actions.findIndex((action) => action.id === this.list.getSelectedItem()?.value);
      this.list.setSelectedIndex(index + (this.keys.matches(data, "tui.select.pageUp") ? -4 : 4));
    } else if (this.keys.matches(data, "tui.select.up") || this.keys.matches(data, "tui.select.down")) this.list.handleInput(data);
    else this.input.handleInput(data);
    this.refresh();
    this.tui.requestRender();
  }

  render(width: number): string[] {
    this.refresh();
    const action = this.actions.find((item) => item.id === this.list.getSelectedItem()?.value);
    const hint = action?.disabled ?? (action?.source === "extension" ? "Run via Pi · existing checks apply"
      : action ? "Stage in editor · submit normally to run" : "No matching commands");
    return [
      this.theme.fg("accent", `Neura launcher · ${modeLabel(getMode())}`),
      ...this.input.render(Math.max(1, width)), ...this.list.render(Math.max(3, width)),
      this.theme.fg(action?.disabled ? "warning" : "muted", hint),
      this.theme.fg("muted", `${action?.shortcut ? `Shortcut: ${action.shortcut} · ` : ""}${action?.description ?? ""}`),
      this.theme.fg("dim", "↑/↓ move · Enter select · Esc close"),
    ].map((line) => truncateToWidth(line, Math.max(1, width), ""));
  }

  invalidate() { this.input.invalidate(); this.list.invalidate(); }
}

export function registerCommandLauncher(pi: ExtensionAPI) {
  let open = false;
  let generation = 0;
  let close: (() => void) | undefined;
  const reset = () => { generation++; close?.(); };
  pi.on("session_start", reset);
  pi.on("session_shutdown", reset);
  const read = (ctx: ExtensionContext) => launcherActions(pi.getCommands(), ctx.isIdle());
  const launch = async (ctx: ExtensionContext) => {
    if (ctx.mode !== "tui" || !ctx.hasUI) return;
    if (open) return;
    open = true;
    const owner = generation;
    try {
      const selected = await ctx.ui.custom<LauncherAction | undefined>((tui, theme, keys, done) => {
        close = () => done(undefined);
        return new CommandLauncher(tui, theme, keys, () => read(ctx), done);
      });
      if (!selected || owner !== generation) return;
      const current = read(ctx).find((action) => action.id === selected.id);
      if (!current || current.disabled) {
        ctx.ui.notify(current?.disabled ?? "Command is no longer available. Reopen the launcher.", "warning");
        return;
      }
      if (current.source !== "extension") {
        // Never replace an unsent draft, or silently execute a prompt/skill.
        if (ctx.ui.getEditorText()) {
          ctx.ui.notify("Editor has a draft. Submit or clear it before staging a command.", "warning");
          return;
        }
        ctx.ui.setEditorText(current.command + " ");
        ctx.ui.notify("Command staged in editor; submit normally to run.", "info");
      } else {
        // Supported normal dispatch: confirmations/policy belong to the handler.
        // Pi reports asynchronous errors through its normal extension error UI.
        pi.sendUserMessage(current.command, { expandPromptTemplates: true });
      }
    } catch {
      // Do not surface potentially secret-bearing error messages.
      ctx.ui.notify("Launcher could not complete. Use the slash command directly.", "error");
    } finally { close = undefined; open = false; }
  };
  pi.registerCommand("launcher", { description: "Search public commands and Neura modes (Ctrl+Shift+K)", handler: async (_args, ctx) => launch(ctx) });
  pi.registerShortcut(LAUNCHER_SHORTCUT, { description: "Open Neura command launcher", handler: launch });
}

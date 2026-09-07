export const MODES = ["plan", "yolo", "human-away", "learn"] as const;

export type AgentMode = (typeof MODES)[number];
export type ModeChangeSource = "restore" | "command" | "shortcut" | "internal";

export type ModeChange = {
  previous: AgentMode;
  current: AgentMode;
  source: ModeChangeSource;
};

type SharedModeState = {
  current: AgentMode;
  listeners: Set<(change: ModeChange) => void>;
  hostOperations?: number;
};

const STATE_KEY = Symbol.for("neura.mode-state.v1");
const globalRegistry = globalThis as typeof globalThis & { [STATE_KEY]?: SharedModeState };
const shared = globalRegistry[STATE_KEY] ??= { current: "yolo", listeners: new Set() };

export function isAgentMode(value: unknown): value is AgentMode {
  return typeof value === "string" && (MODES as readonly string[]).includes(value);
}

export function getMode(): AgentMode {
  return shared.current;
}

export function setMode(next: AgentMode, source: ModeChangeSource = "internal"): ModeChange {
  if (!isAgentMode(next)) throw new Error("Unknown Neura mode; current boundary remains active.");
  if (next !== shared.current && isHostOperationActive()) throw new Error("Mode change blocked while a host operation is running.");
  const change = { previous: shared.current, current: next, source };
  shared.current = next;
  if (change.previous !== change.current || source === "restore") {
    for (const listener of shared.listeners) {
      try { listener(change); } catch {}
    }
  }
  return change;
}

export function isHostOperationActive(): boolean {
  return (shared.hostOperations ?? 0) > 0;
}

// Prevent a background proof/checkpoint launched in YOLO from crossing into a
// restricted mode after the foreground agent becomes idle.
export function acquireHostOperation(): (() => void) | null {
  if (shared.current !== "yolo") return null;
  shared.hostOperations = (shared.hostOperations ?? 0) + 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    shared.hostOperations = Math.max(0, (shared.hostOperations ?? 1) - 1);
  };
}

export function nextMode(mode: AgentMode = shared.current): AgentMode {
  return MODES[(MODES.indexOf(mode) + 1) % MODES.length];
}

export function onModeChange(listener: (change: ModeChange) => void): () => void {
  shared.listeners.add(listener);
  return () => shared.listeners.delete(listener);
}

export function modeLabel(mode: AgentMode): string {
  return mode === "human-away" ? "HUMAN AWAY · PREVIEW" : mode.toUpperCase();
}

export function modePosition(mode: AgentMode): string {
  return `${MODES.indexOf(mode) + 1} / ${MODES.length}`;
}

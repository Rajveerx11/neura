export const MODES = ["plan", "work", "yolo", "human-away"] as const;

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
};

const STATE_KEY = Symbol.for("neura.mode-state.v1");
const globalRegistry = globalThis as typeof globalThis & { [STATE_KEY]?: SharedModeState };
const shared = globalRegistry[STATE_KEY] ??= { current: "work", listeners: new Set() };

export function isAgentMode(value: unknown): value is AgentMode {
  return typeof value === "string" && (MODES as readonly string[]).includes(value);
}

export function getMode(): AgentMode {
  return shared.current;
}

export function setMode(next: AgentMode, source: ModeChangeSource = "internal"): ModeChange {
  const change = { previous: shared.current, current: next, source };
  shared.current = next;
  if (change.previous !== change.current || source === "restore") {
    for (const listener of shared.listeners) {
      try { listener(change); } catch {}
    }
  }
  return change;
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

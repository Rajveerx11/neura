export type CockpitPhase = "READY" | "BRIEF" | "WORK" | "REVIEW" | "VERIFY" | "RECOVERY" | "COMPLETE" | "DEGRADED";
export type CockpitTone = "neutral" | "info" | "success" | "warning" | "error";

export type CockpitOperation = {
  verb: string;
  target?: string;
  startedAt?: number;
};

export type CockpitNotice = {
  id: string;
  message: string;
  detail?: string;
  tone: CockpitTone;
  persistent?: boolean;
};

export type CockpitProof = {
  scope: "quick" | "full";
  status: "running" | "passed" | "failed" | "unavailable";
  detail?: string;
};

export type CockpitApproval = {
  id: string;
  agent: string;
  task: string;
  exactAction: string;
  boundary: string;
  fallback: string;
  risk: string;
  approvable: boolean;
};

export type CockpitCopy = {
  available: boolean;
  codeBlocks: number;
  feedback?: string;
};

export type CockpitState = {
  phase: CockpitPhase;
  launchVisible: boolean;
  task?: string;
  step?: string;
  operation?: CockpitOperation;
  notices: CockpitNotice[];
  proof?: CockpitProof;
  approval?: CockpitApproval;
  copy: CockpitCopy;
  checkpoint?: "capturing" | "ready" | "restoring" | "restored" | "failed";
  degraded?: string;
  updatedAt: number;
};

type SharedCockpit = {
  state: CockpitState;
  listeners: Set<(state: CockpitState) => void>;
};

const STATE_KEY = Symbol.for("neura.cockpit-state.v1");
const globalRegistry = globalThis as typeof globalThis & { [STATE_KEY]?: SharedCockpit };

function initialState(): CockpitState {
  return {
    phase: "READY",
    launchVisible: false,
    notices: [],
    copy: { available: false, codeBlocks: 0 },
    updatedAt: Date.now(),
  };
}

const shared = globalRegistry[STATE_KEY] ??= { state: initialState(), listeners: new Set() };

function publish(next: CockpitState): CockpitState {
  shared.state = next;
  for (const listener of shared.listeners) {
    try { listener(next); } catch {}
  }
  return next;
}

export function getCockpitState(): CockpitState {
  return shared.state;
}

export function patchCockpit(patch: Partial<Omit<CockpitState, "updatedAt">>): CockpitState {
  const sanitized = redactSensitiveValue(patch) as Partial<Omit<CockpitState, "updatedAt">>;
  return publish({ ...shared.state, ...sanitized, updatedAt: Date.now() });
}

export function resetCockpit(): CockpitState {
  return publish(initialState());
}

export function addCockpitNotice(notice: CockpitNotice): CockpitState {
  const notices = [...shared.state.notices.filter((item) => item.id !== notice.id), notice].slice(-8);
  return patchCockpit({ notices });
}

export function removeCockpitNotice(id: string): CockpitState {
  return patchCockpit({ notices: shared.state.notices.filter((item) => item.id !== id) });
}

export function onCockpitChange(listener: (state: CockpitState) => void): () => void {
  shared.listeners.add(listener);
  return () => shared.listeners.delete(listener);
}
import { redactSensitiveValue } from "./redaction.ts";

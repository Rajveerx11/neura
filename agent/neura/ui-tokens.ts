import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export const PALETTE = {
  canvas: "#080a0f",
  surface: "#101522",
  raised: "#151c2d",
  accent: "#2979ff",
  focus: "#72a7ff",
  plan: "#7cc7ff",
  learn: "#af94ff",
  human: "#f3c860",
  info: "#7cc7ff",
  text: "#f3f6ff",
  muted: "#b4bece",
  dim: "#8894a8",
  border: "#26334c",
  warning: "#f3c860",
  error: "#ff8178",
  success: "#5cd99c",
} as const;

export const GLYPHS = {
  neura: "◆",
  plan: "◇",
  learn: "◇",
  yolo: "◆",
  humanAway: "◇",
  success: "✓",
  error: "×",
  pending: "◆",
  prompt: "›",
  divider: "─",
} as const;

export const MOTION = {
  immediateMs: 60,
  frameMs: 52,
  frames: 7,
  settleMs: 340,
  holdMs: 520,
  copyFeedbackMs: 1_200,
} as const;

export type WidthTier = "micro" | "narrow" | "compact" | "standard" | "wide";

export function widthTier(width: number): WidthTier {
  if (width < 48) return "micro";
  if (width < 56) return "narrow";
  if (width < 72) return "compact";
  if (width < 92) return "standard";
  return "wide";
}

export function fitLine(value: string, width: number): string {
  return truncateToWidth(value, Math.max(1, width));
}

export function padLine(value: string, width: number): string {
  return value + " ".repeat(Math.max(0, width - visibleWidth(value)));
}

export function joinFitting(parts: string[], separator: string, width: number): string {
  const selected: string[] = [];
  for (const part of parts.filter(Boolean)) {
    const candidate = [...selected, part].join(separator);
    if (selected.length && visibleWidth(candidate) > width) break;
    selected.push(part);
  }
  return fitLine(selected.join(separator), width);
}

export function quietRule(width: number, cap = 72): string {
  return GLYPHS.divider.repeat(Math.max(1, Math.min(width, cap)));
}

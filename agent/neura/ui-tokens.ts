import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export { PALETTE } from "./palette.ts";

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

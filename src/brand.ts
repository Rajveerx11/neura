// Approved lowercase pixel wordmark (2026-11-23), pre-rendered with standard half-block characters:
// five-pixel letters, two pixel rows per terminal row. terminal-ui.ts adds the copper-to-bone color.
// No image renderer, font lookup or filesystem access belongs in the runtime logo path.
const LOGO = [
  '▄▄▄▄   ▄▄▄  ▄   ▄ ▄ ▄▄▄  ▄▄▄',
  '█   █ █▄▄▄█ █   █ █▀     ▄▄▄█',
  '█   █ ▀▄▄▄▄ ▀▄▄▄█ █     ▀▄▄▄█',
] as const;
const ASCII_LOGO = '>_ neura';
export const LOGO_WIDTH = Math.max(...LOGO.map(line => line.length));

/** Reserve the last column to avoid wrap-induced blank rows. Never emit ANSI. */
export function renderLogo(columns = 80, ascii = false): string[] {
  const available = Number.isFinite(columns) ? Math.max(1, Math.floor(columns) - 1) : 79;
  if (ascii || LOGO_WIDTH > available) return [ASCII_LOGO.slice(0, available)];
  return [...LOGO];
}

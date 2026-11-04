// Approved context-to-action mark, pre-rendered with standard half-block characters.
// No image renderer, font lookup or filesystem access belongs in the runtime logo path.
const LOGO = [
  '▄▄',
  '██',
  '▀██        ▄',
  ' ▀█▄       ██▄',
  '  ▀▀██▄▄▄▄▄▄███▄',
  '  ▄▄██▀▀▀▀▀▀███▀    neura',
  ' ▄█▀       ██▀',
  '▄█▀        ▀',
  '██',
  '▀▀',
] as const;
const ASCII_LOGO = '>_ neura';

/** Reserve the last column to avoid wrap-induced blank rows. Never emit ANSI. */
export function renderLogo(columns = 80, ascii = false): string[] {
  const available = Number.isFinite(columns) ? Math.max(1, Math.floor(columns) - 1) : 79;
  if (ascii || LOGO.some(line => line.length > available)) return [ASCII_LOGO.slice(0, available)];
  return [...LOGO];
}

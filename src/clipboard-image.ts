import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Providers cap images near 5 MB once base64-encoded. ponytail: refuse larger PNGs; downscale if real screenshots hit it. */
export const MAX_IMAGE_BYTES = 3_750_000;

// A copied bitmap first, else the first image file copied in Explorer. Prints base64 PNG, or nothing.
const WINDOWS_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms, System.Drawing',
  '$image = [Windows.Forms.Clipboard]::GetImage()',
  "if (-not $image) { $file = [Windows.Forms.Clipboard]::GetFileDropList() | Where-Object { $_ -match '\\.(png|jpe?g|gif|bmp|webp)$' } | Select-Object -First 1; if ($file) { $image = [Drawing.Image]::FromFile($file) } }",
  'if ($image) { $stream = New-Object IO.MemoryStream; $image.Save($stream, [Drawing.Imaging.ImageFormat]::Png); [Convert]::ToBase64String($stream.ToArray()) }',
].join('; ');

/** PNG bytes from the clipboard, or undefined when it holds no image. */
export async function readClipboardImage(): Promise<Buffer | undefined> {
  // ponytail: Windows only; add pngpaste (macOS) or wl-paste/xclip (Linux) when Neura ships there.
  if (process.platform !== 'win32') throw new Error('Image paste currently works on Windows only.');
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', WINDOWS_SCRIPT],
    { windowsHide: true, timeout: 15_000, maxBuffer: 64 * 1024 * 1024 });
  const text = stdout.trim();
  if (!text) return undefined;
  if (!/^[A-Za-z0-9+/]+=*$/.test(text)) throw new Error('The clipboard image could not be read.');
  return Buffer.from(text, 'base64');
}

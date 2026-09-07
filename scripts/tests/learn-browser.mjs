import { isolate } from './isolation.mjs';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
const channel = process.env.NEURA_BROWSER_CHANNEL;
// Browser discovery needs OS installation locations, never the real browser profile.
const installation = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(?:programfiles(?:\(x86\))?|programw6432)$/i.test(key)));
const scratch = isolate();
// Windows Known Folder lookup requires the synthetic profile's actual standard
// directories to exist. An unresolved default profile makes branded Chromium
// reject debugging even when Playwright supplies a separate user-data-dir.
Object.assign(process.env, {
  APPDATA: path.join(scratch, 'AppData', 'Roaming'),
  LOCALAPPDATA: path.join(scratch, 'AppData', 'Local'),
  TEMP: path.join(scratch, 'Temp'), TMP: path.join(scratch, 'Temp'),
});
for (const key of ['APPDATA', 'LOCALAPPDATA', 'TEMP']) mkdirSync(process.env[key], { recursive: true });
Object.assign(process.env, installation);
if (channel !== undefined) {
  if (!['msedge', 'chrome', 'chromium'].includes(channel)) throw new Error('Unsupported Learn browser test channel.');
  process.env.NEURA_BROWSER_CHANNEL = channel;
}
await import('../verify-learn-browser.mjs');

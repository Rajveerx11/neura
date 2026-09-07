import { isolate } from './isolation.mjs';
const channel = process.env.NEURA_BROWSER_CHANNEL;
// Browser discovery needs OS installation locations, never the real browser profile.
const installation = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(?:programfiles(?:\(x86\))?|programw6432)$/i.test(key)));
isolate();
Object.assign(process.env, installation);
if (channel !== undefined) {
  if (!['msedge', 'chrome', 'chromium'].includes(channel)) throw new Error('Unsupported Learn browser test channel.');
  process.env.NEURA_BROWSER_CHANNEL = channel;
}
await import('../verify-learn-browser.mjs');

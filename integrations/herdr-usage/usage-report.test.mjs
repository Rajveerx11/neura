import assert from "node:assert/strict";
import test from "node:test";
import { credentialsFor, normalizeClaude, normalizeCodex, normalizeCursor, renderUsage } from "./usage-report.mjs";

test("credential readers accept only current access tokens and reject API-key/refresh-token-only input", () => {
  const candidate = () => [process.execPath];
  assert.deepEqual(credentialsFor("claude", {}, () => ({ claudeAiOauth: { accessToken: "current", refreshToken: "never-used" } }), candidate), { token: "current", plan: undefined });
  assert.equal(credentialsFor("codex", {}, () => ({ OPENAI_API_KEY: "not-an-account-window" }), candidate), undefined);
  assert.equal(credentialsFor("cursor", {}, () => ({ refreshToken: "never-used" }), candidate), undefined);
});

test("Claude normalization renders remaining usage without retaining token data", () => {
  const usage = normalizeClaude({
    five_hour: { utilization: 19.6, resets_at: "2026-09-15T20:00:00Z" },
    seven_day: { utilization: 75.4, resets_at: "2026-09-20T20:00:00Z" },
  }, "max");
  assert.equal(usage.plan, "max");
  assert.deepEqual(usage.windows.map((entry) => entry.remaining), [80, 25]);
  assert.equal(renderUsage(usage), "5h 80% · Wk 25%");
});

test("Codex accepts either reset representation and labels API windows", () => {
  const usage = normalizeCodex({ rate_limit: {
    primary_window: { used_percent: 1, limit_window_seconds: 18_000, reset_at: 1_800_000_000 },
    secondary_window: { used_percent: 100, limit_window_seconds: 604_800, reset_after_seconds: 60 },
  } });
  assert.deepEqual(usage.windows.map((entry) => [entry.label, entry.remaining]), [["5h", 99], ["Wk", 0]]);
  assert.equal(usage.windows[0].reset, 1_800_000_000);
});

test("Cursor supports current API spelling and treats absent quota as unavailable", () => {
  const usage = normalizeCursor({
    individualUsage: { plan: { totalPercentUsed: "39.5" } },
    billingCycleEnd: "2026-10-01T00:00:00Z",
  });
  assert.equal(renderUsage(usage), "Plan 61%");
  assert.ok(Number.isInteger(usage.windows[0].reset));
  assert.equal(renderUsage(normalizeCursor({})), "usage unavailable");
});

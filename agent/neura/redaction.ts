const REDACTED = "[REDACTED]";

function redactUrlQuery(url: string): string {
  const query = url.indexOf("?");
  if (query < 0) return url;
  const fragment = url.indexOf("#", query);
  const end = fragment < 0 ? url.length : fragment;
  const redactedQuery = url.slice(query + 1, end).replace(/(^|&)([^=&\s]+)=([^&\s]*)/g, `$1$2=${REDACTED}`);
  return `${url.slice(0, query + 1)}${redactedQuery}${url.slice(end)}`;
}

function entropy(value: string): number {
  const counts = new Map<string, number>();
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1);
  let total = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    total -= probability * Math.log2(probability);
  }
  return total;
}

function redactHighEntropy(value: string): string {
  return value.replace(/[A-Za-z0-9+_=-]{32,}/g, (candidate) => {
    if (candidate === REDACTED || entropy(candidate) < 3.5) return candidate;
    return REDACTED;
  });
}

export function redactSensitiveText(value: unknown, limit = Number.POSITIVE_INFINITY): string {
  let text = String(value ?? "");
  text = text
    .replace(/\b((?:authorization|proxy-authorization|x-api-key|api-key|cookie|set-cookie)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\r\n;]+)/ig, `$1${REDACTED}`)
    .replace(/\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|CREDENTIAL)\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s;]+)/ig, `$1${REDACTED}`)
    .replace(/(--?(?:password|passwd|token|api-key|secret|credential)\s+)(?:"[^"]*"|'[^']*'|[^\s;]+)/ig, `$1${REDACTED}`)
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s/]+(@)/ig, `$1${REDACTED}$2`)
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{16,}|AIza[0-9A-Za-z_-]{20,}|AKIA[0-9A-Z]{16})\b/g, REDACTED)
    .replace(/\bhttps?:\/\/[^\s<>"']+/ig, redactUrlQuery);
  text = redactHighEntropy(text);
  return text.slice(0, Math.max(0, limit));
}

export function redactSensitiveValue(value: unknown): unknown {
  if (typeof value === "string") return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map(redactSensitiveValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, redactSensitiveValue(item)]));
  }
  return value;
}

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

function redactPrivateKeyBlocks(text: string, checkBudget?: () => void): string {
  // Scan boundary tokens once. A lazy whole-block regex retries the remaining
  // file for every unterminated BEGIN, making hostile failed matches quadratic.
  const boundaries = /-----BEGIN [A-Z ]*PRIVATE KEY-----|-----END [A-Z ]*PRIVATE KEY-----/g;
  const parts: string[] = [];
  let start = -1;
  let cursor = 0;
  for (const match of text.matchAll(boundaries)) {
    checkBudget?.();
    if (match[0].startsWith("-----BEGIN ")) {
      if (start < 0) start = match.index;
    } else if (start >= 0) {
      parts.push(text.slice(cursor, start), REDACTED);
      cursor = match.index + match[0].length;
      start = -1;
    }
  }
  // Preserve the existing treatment of incomplete blocks and surrounding text.
  return parts.length ? parts.join("") + text.slice(cursor) : text;
}

function redactUrlCredentials(text: string, checkBudget?: () => void): string {
  // Start only at a maximal scheme-character run, not every internal word
  // boundary in a failed a-a-a-... match. Keep the old recognition boundary,
  // including leading punctuation and a valid suffix after an invalid prefix.
  return text.replace(/(?<![a-z0-9+.-])([a-z0-9+.-]+):\/\/([^:\s/@]+):([^@\s/]+)@/ig,
    (match, scheme, user, _password, offset) => {
      checkBudget?.();
      const boundary = /\b[a-z]/ig;
      if (offset > 0 && /\w/.test(text[offset - 1])) boundary.lastIndex = 1;
      return boundary.test(scheme) ? `${scheme}://${user}:${REDACTED}@` : match;
    });
}

export function redactSensitiveText(value: unknown, limit = Number.POSITIVE_INFINITY, checkBudget?: () => void): string {
  checkBudget?.();
  let text = redactPrivateKeyBlocks(String(value ?? ""), checkBudget);
  checkBudget?.();
  text = text
    .replace(/(["'](?:password|passwd|token|secret|api[_-]?key|credential|authorization|cookie)["']\s*:\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/ig, `$1"${REDACTED}"`)
    .replace(/\b((?:authorization|proxy-authorization|x-api-key|api-key|cookie|set-cookie)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\r\n;]+)/ig, `$1${REDACTED}`)
    .replace(/\b((?:[A-Z][A-Z0-9_]*)?(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|CREDENTIAL)\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s;]+)/ig, `$1${REDACTED}`)
    .replace(/(--?(?:password|passwd|token|api-key|secret|credential)\s+)(?:"[^"]*"|'[^']*'|[^\s;]+)/ig, `$1${REDACTED}`);
  checkBudget?.();
  text = redactUrlCredentials(text, checkBudget)
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{16,}|AIza[0-9A-Za-z_-]{20,}|AKIA[0-9A-Z]{16})\b/g, REDACTED)
    .replace(/\bhttps?:\/\/[^\s<>"']+/ig, redactUrlQuery);
  checkBudget?.();
  text = redactHighEntropy(text);
  checkBudget?.();
  return text.slice(0, Math.max(0, limit));
}

// Preserve Pi's tool declarations/envelopes; redact only model-visible content.
// Images from prior modes are opaque and cannot be safely text-redacted.
export function redactPlanContextMessages(messages: any[]): any[] {
  return messages.map(message => ({
    ...message,
    content: Array.isArray(message.content)
      ? message.content.map(block => block.type === "image"
        ? { type: "text", text: "[Opaque image withheld in Plan.]" } : redactSensitiveValue(block))
      : redactSensitiveValue(message.content),
    ...(message.sections ? { sections: redactSensitiveValue(message.sections) } : {}),
    ...(message.details ? { details: redactSensitiveValue(message.details) } : {}),
    ...(message.structuredContent ? { structuredContent: redactSensitiveValue(message.structuredContent) } : {}),
  }));
}

export function redactSensitiveValue(value: unknown): unknown {
  if (typeof value === "string") return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map(redactSensitiveValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, /^(?:password|passwd|token|secret|api[_-]?key|credential|authorization|cookie)$/i.test(key)
        ? REDACTED : redactSensitiveValue(item)]));
  }
  return value;
}

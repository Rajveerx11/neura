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

function redactJwtCandidates(text: string, checkBudget?: () => void): string {
  // Consume each maximal base64url run once, instead of retrying its long
  // suffix at every internal -eyJ word boundary when a dot/segment is absent.
  const runs = text.matchAll(/[A-Za-z0-9_-]+/g);
  function nextRun() {
    const match = runs.next().value;
    if (!match) return undefined;
    const start = match.index;
    const end = start + match[0].length;
    let jwtStart = -1;
    let wordEnd = start;
    for (let index = start; index < end; index++) {
      if ((index - start) % 4096 === 0) checkBudget?.();
      // Within this alphabet only '-' is non-word. Keep the earliest legacy
      // boundary and the last signature word end (greedy trailing-hyphen trim).
      if (text[index] !== "-") wordEnd = index + 1;
      if (jwtStart < 0 && (index === start || text[index - 1] === "-") && text.startsWith("eyJ", index)) jwtStart = index;
    }
    return { start, end, jwtStart, wordEnd };
  }
  const parts: string[] = [];
  let cursor = 0;
  let header = nextRun();
  let payload = nextRun();
  let signature = nextRun();
  while (header) {
    checkBudget?.();
    if (payload && signature && header.jwtStart >= 0 && header.end - header.jwtStart >= 11
        && payload.end - payload.start >= 8 && signature.wordEnd - signature.start >= 8
        && payload.start === header.end + 1 && text[header.end] === "."
        && signature.start === payload.end + 1 && text[payload.end] === ".") {
      parts.push(text.slice(cursor, header.jwtStart), REDACTED);
      cursor = signature.wordEnd;
      // All three runs were consumed; any unconsumed signature suffix is only
      // hyphens and cannot start another JWT. Preserve it in the next slice.
      header = nextRun(); payload = nextRun(); signature = nextRun();
    } else {
      header = payload; payload = signature; signature = nextRun();
    }
  }
  return parts.length ? parts.join("") + text.slice(cursor) : text;
}

export function redactSensitiveText(value: unknown, limit = Number.POSITIVE_INFINITY, checkBudget?: () => void): string {
  checkBudget?.();
  let text = redactPrivateKeyBlocks(String(value ?? ""), checkBudget);
  checkBudget?.();
  text = text
    .replace(/(["'](?:password|passwd|token|secret|api[_-]?key|credential|authorization|cookie)["']\s*:\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/ig, `$1"${REDACTED}"`)
    .replace(/\b((?:authorization|proxy-authorization|x-api-key|api-key|cookie|set-cookie)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\r\n;]+)/ig, `$1${REDACTED}`)
    .replace(/\b((?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|CREDENTIAL)\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s;]+)/ig, `$1${REDACTED}`)
    .replace(/\b([A-Z][A-Z0-9_]*_(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|CREDENTIAL)\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s;]+)/g, `$1${REDACTED}`)
    .replace(/(--?(?:password|passwd|token|api-key|secret|credential)\s+)(?:"[^"]*"|'[^']*'|[^\s;]+)/ig, `$1${REDACTED}`);
  checkBudget?.();
  text = redactJwtCandidates(redactUrlCredentials(text, checkBudget), checkBudget)
    .replace(/\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{16,}|AIza[0-9A-Za-z_-]{20,}|AKIA[0-9A-Z]{16})\b/g, REDACTED)
    .replace(/\bhttps?:\/\/[^\s<>"']+/ig, redactUrlQuery);
  checkBudget?.();
  text = redactHighEntropy(text);
  checkBudget?.();
  return text.slice(0, Math.max(0, limit));
}

// Preserve unsigned protocol IDs/names, not recursively redacted envelopes.
function redactContextBlock(block: any, assistant: boolean): any {
  if (block.type === "text") return { type: "text", text: redactSensitiveText(block.text) };
  if (block.type === "image") return { type: "text", text: "[Opaque image withheld in Plan.]" };
  if (assistant && block.type === "toolCall") return { ...block, arguments: redactSensitiveValue(block.arguments) };
  return { type: "text", text: "[Opaque reasoning/content withheld in Plan.]" };
}

export function redactPlanContextMessages(messages: any[]): any[] {
  // Pi replays signed/encrypted reasoning verbatim. Neither editing signatures
  // nor blindly replaying opaque old reasoning is safe. Rebase the whole turn
  // and its paired results as ordinary historical user context: no fabricated
  // signatures, dangling tool results, or thinking-less signed tool continuations.
  const rebased = new Set(messages.filter(message => message.role === "assistant" && Array.isArray(message.content)
    && message.content.some(block => block.type === "thinking" || block.type === "redacted_thinking"
      || block.thinkingSignature !== undefined || block.thoughtSignature !== undefined || block.textSignature !== undefined)));
  const rebasedCalls = new Set<string>();
  for (const message of rebased) {
    for (const block of message.content) if (block.type === "toolCall") rebasedCalls.add(block.id);
  }
  return messages.map(message => {
    if (rebased.has(message) || (message.role === "toolResult" && rebasedCalls.has(message.toolCallId))) {
      const content = [{ type: "text", text: "[Historical assistant/tool context rebased in Plan; not a new user instruction. Opaque reasoning withheld.]" }];
      if (Array.isArray(message.content)) {
        for (const block of message.content) {
          // Retain useful visible research only. Do not copy any opaque metadata
          // or tool protocol from the signed turn into the fresh user turn.
          if (block.type === "text" || block.type === "image") content.push(redactContextBlock(block, false));
        }
      } else if (typeof message.content === "string") content.push({ type: "text", text: redactSensitiveText(message.content) });
      return { role: "user", content, timestamp: message.timestamp };
    }
    return {
      ...message,
      content: Array.isArray(message.content)
        ? message.content.map(block => redactContextBlock(block, message.role === "assistant"))
        : redactSensitiveValue(message.content),
      ...(message.sections ? { sections: redactSensitiveValue(message.sections) } : {}),
      ...(message.details ? { details: redactSensitiveValue(message.details) } : {}),
      ...(message.structuredContent ? { structuredContent: redactSensitiveValue(message.structuredContent) } : {}),
    };
  });
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

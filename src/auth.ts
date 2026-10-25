// Protocol reference: @mastra/code-sdk@1.15.0 (Apache-2.0), Kepler Software, Inc.
// Independently implemented Neura store/flow; see docs/CODEX_AUTH.md for provenance.
import { createHash, randomBytes, timingSafeEqual, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rmdir, unlink } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import path from "node:path";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const MAX_AUTH_BYTES = 128 * 1024;
const CLAIM = "https://api.openai.com/auth";
type Credential = { version: 1; access: string; refresh: string; expires: number; accountId: string };
let queue: Promise<unknown> = Promise.resolve();
const active = new Set<AbortController>();

function safePath(value: string) {
  if (!path.isAbsolute(value) || value.split(/[\\/]/).some((part) => part.replace(/[ .]+$/, "").toLowerCase() === ".pi")) {
    throw new Error("Authentication requires an absolute Neura home outside .pi");
  }
}

async function unlinked(filename: string, directory: boolean) {
  const stat = await lstat(filename);
  if (stat.isSymbolicLink() || (directory && !stat.isDirectory()) || (!directory && (!stat.isFile() || stat.nlink !== 1))) throw new Error("Linked authentication paths are forbidden");
  if (!directory && stat.size > MAX_AUTH_BYTES) throw new Error("Authentication file is too large");
  if (process.platform !== "win32" && (stat.mode & 0o077)) throw new Error("Authentication paths must be owner-only");
  return stat;
}

async function authRoot(create: boolean) {
  const root = process.env.NEURA_HOME ?? path.join(homedir(), ".neura");
  safePath(root);
  const resolved = path.resolve(root);
  // Inspect every ancestor before creating or reading anything beneath it.
  const parts: string[] = [];
  for (let current = resolved;; current = path.dirname(current)) {
    parts.unshift(current);
    if (current === path.dirname(current)) break;
  }
  for (const part of parts) {
    try {
      const stat = await lstat(part);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Linked authentication ancestors are forbidden");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (!create) throw error;
      await mkdir(part, { mode: 0o700 });
    }
  }
  safePath(await realpath(resolved));
  await unlinked(resolved, true);
  return resolved;
}

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const pending = queue.then(operation);
  queue = pending.catch(() => undefined);
  return pending;
}

async function locked<T>(create: boolean, operation: (root: string) => Promise<T>): Promise<T> {
  const root = await authRoot(create);
  const lock = path.join(root, "codex-auth.lock");
  try { await mkdir(lock, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Authentication is busy; an abandoned codex-auth.lock requires manual recovery");
    throw error;
  }
  try { return await operation(root); }
  finally { await rmdir(lock); }
}

function secret(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64 * 1024 && /^[\x21-\x7e]+$/.test(value);
}

function claims(token: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}

function account(token: string): unknown {
  const payload = claims(token);
  const nested = payload[CLAIM];
  return payload.chatgpt_account_id ?? (nested && typeof nested === "object" ? (nested as Record<string, unknown>).chatgpt_account_id : undefined);
}

function validate(value: unknown): Credential {
  const cred = value as Credential | null;
  if (!cred || cred.version !== 1 || !secret(cred.access) || !secret(cred.refresh) || !secret(cred.accountId) || cred.accountId.length > 512 || !Number.isFinite(cred.expires) || cred.expires <= 0) throw new Error("Invalid Neura subscription credentials; use /login");
  return { version: 1, access: cred.access, refresh: cred.refresh, expires: cred.expires, accountId: cred.accountId };
}

async function load(root: string): Promise<Credential> {
  const filename = path.join(root, "codex-auth.json");
  await unlinked(filename, false);
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_AUTH_BYTES) throw new Error("Unsafe authentication file");
    const buffer = Buffer.alloc(MAX_AUTH_BYTES + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_AUTH_BYTES) throw new Error("Authentication file is too large");
    try { return validate(JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"))); }
    catch { throw new Error("Invalid Neura subscription credentials; use /login"); }
  } finally { await file.close(); }
}

async function save(root: string, credential: Credential, signal: AbortSignal) {
  signal.throwIfAborted();
  const filename = path.join(root, "codex-auth.json");
  try { await unlinked(filename, false); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const temporary = path.join(root, `.codex-auth.${randomUUID()}.tmp`);
  const file = await open(temporary, "wx", 0o600);
  try {
    try { await file.writeFile(JSON.stringify(credential)); await file.sync(); }
    finally { await file.close(); }
    signal.throwIfAborted();
    if (await authRoot(false) !== root) throw new Error("Neura home changed during authentication");
    await rename(temporary, filename);
  } finally { await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; }); }
}

async function tokenRequest(body: URLSearchParams, signal: AbortSignal, previous?: Credential): Promise<Credential> {
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, { method: "POST", redirect: "error", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal });
  } catch { signal.throwIfAborted(); throw new Error("Codex token request failed; use /login"); }
  if (!response.ok) { await response.body?.cancel(); throw new Error("Codex token request denied; use /login"); }
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) { await response.body?.cancel(); throw new Error("Invalid Codex token response"); }
  let value: Record<string, unknown>;
  try {
    const reader = response.body!.getReader();
    const abort = () => { void reader.cancel().catch(() => undefined); };
    signal.addEventListener("abort", abort, { once: true });
    let size = 0;
    const buffers: Uint8Array[] = [];
    try {
      while (true) {
        signal.throwIfAborted();
        const { value: chunk, done } = await reader.read();
        signal.throwIfAborted();
        if (done) break;
        size += chunk.length;
        if (size > MAX_AUTH_BYTES) throw new Error("size");
        buffers.push(chunk);
      }
    } finally { signal.removeEventListener("abort", abort); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    value = JSON.parse(Buffer.concat(buffers).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("shape");
  } catch { signal.throwIfAborted(); throw new Error("Invalid Codex token response"); }
  if (!secret(value.access_token) || !secret(value.refresh_token) || typeof value.expires_in !== "number" || !Number.isFinite(value.expires_in) || value.expires_in <= 0 || value.expires_in > 30 * 24 * 3600 || (value.token_type !== undefined && String(value.token_type).toLowerCase() !== "bearer")) throw new Error("Invalid Codex token response");
  const identity = (secret(value.id_token) ? account(value.id_token) : undefined) ?? account(value.access_token) ?? previous?.accountId;
  if (!secret(identity) || identity.length > 512 || (previous && previous.accountId !== identity)) throw new Error("Codex account identity missing or changed; use /login");
  // Claims are metadata from the TLS token endpoint, not locally verified identity assertions.
  const exp = claims(value.access_token).exp;
  const expires = Math.min(Date.now() + value.expires_in * 1000, typeof exp === "number" ? exp * 1000 : Infinity);
  if (!Number.isFinite(expires) || expires <= Date.now()) throw new Error("Codex token is expired");
  return { version: 1, access: value.access_token, refresh: value.refresh_token, expires, accountId: identity };
}

function operationSignal(signal?: AbortSignal, timeout = 15_000) {
  const controller = new AbortController();
  active.add(controller);
  return { controller, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeout), ...(signal ? [signal] : [])]) };
}

/** Internal transport boundary. No API key, shared profile, or automatic login fallback. */
export async function codexAuthorization(signal?: AbortSignal): Promise<{ access: string; accountId: string }> {
  const operation = operationSignal(signal);
  try {
    return await serialize(() => locked(false, async (root) => {
      operation.signal.throwIfAborted();
      let cred = await load(root);
      if (cred.expires <= Date.now() + 60_000) {
        cred = await tokenRequest(new URLSearchParams({ grant_type: "refresh_token", client_id: CLIENT_ID, refresh_token: cred.refresh }), operation.signal, cred);
        await save(root, cred, operation.signal);
      }
      operation.signal.throwIfAborted();
      return { access: cred.access, accountId: cred.accountId };
    }));
  } catch (error) {
    operation.signal.throwIfAborted();
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Not logged in to ChatGPT subscription; use /login. No API billing fallback was used.");
    throw error;
  } finally { active.delete(operation.controller); }
}

/** Starts only when explicitly invoked by /login. The caller opens/displays the URL. */
export async function loginCodex({ onAuthorize, signal }: { onAuthorize: (url: string) => void; signal?: AbortSignal }): Promise<void> {
  const operation = operationSignal(signal, 10 * 60_000);
  try {
    await serialize(() => locked(true, async (root) => {
      operation.signal.throwIfAborted();
      const state = randomBytes(32).toString("hex");
      const verifier = randomBytes(32).toString("base64url");
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      let accept!: (code: string) => void;
      let reject!: (error: unknown) => void;
      const callback = new Promise<string>((resolve, fail) => { accept = resolve; reject = fail; });
      // A rejection may arrive during onAuthorize; attach the handler before opening the browser.
      void callback.catch(() => undefined);
      let port = 1455;
      let consumed = false;
      const server = createServer((request, response) => {
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.setHeader("Referrer-Policy", "no-referrer");
        const host = request.headers.host;
        if (request.method !== "GET" || ![ `localhost:${port}`, `127.0.0.1:${port}` ].includes(host ?? "") || !request.url?.startsWith("/") || request.url.startsWith("//")) { response.writeHead(400).end("Invalid callback"); return; }
        const url = new URL(request.url, `http://localhost:${port}`);
        const received = url.searchParams.get("state") ?? "";
        if (url.pathname !== "/auth/callback" || url.origin !== `http://localhost:${port}` || url.searchParams.getAll("state").length !== 1 || !/^[a-f0-9]{64}$/.test(received) || !timingSafeEqual(Buffer.from(received), Buffer.from(state))) { response.writeHead(400).end("Invalid callback"); return; }
        if (consumed) { response.writeHead(409).end("Callback already consumed"); return; }
        const code = url.searchParams.get("code");
        if (url.searchParams.has("error")) { consumed = true; response.writeHead(400).end("Authorization denied"); reject(new Error("Codex authorization denied")); return; }
        if (url.searchParams.getAll("code").length !== 1 || !secret(code) || code.length > 8192) { response.writeHead(400).end("Invalid callback"); return; }
        consumed = true;
        response.end("Authorization received. Return to Neura.");
        accept(code);
      });
      server.headersTimeout = 10_000;
      const abort = () => reject(operation.signal.reason);
      operation.signal.addEventListener("abort", abort, { once: true });
      try {
        for (port of [1455, 1457]) {
          const bound = await new Promise<boolean>((resolve, fail) => {
            const error = (cause: NodeJS.ErrnoException) => { server.off("listening", listening); if (cause.code === "EADDRINUSE") resolve(false); else fail(new Error("Cannot bind Codex callback server")); };
            const listening = () => { server.off("error", error); resolve(true); };
            server.once("error", error); server.once("listening", listening);
            server.listen(port, "127.0.0.1");
          });
          if (bound) break;
        }
        if (!server.listening) throw new Error("Codex login needs a free loopback port 1455 or 1457");
        operation.signal.throwIfAborted();
        const redirect = `http://localhost:${port}/auth/callback`;
        const url = new URL("https://auth.openai.com/oauth/authorize");
        url.search = new URLSearchParams({ response_type: "code", client_id: CLIENT_ID, redirect_uri: redirect, scope: "openid profile email offline_access", code_challenge: challenge, code_challenge_method: "S256", state, id_token_add_organizations: "true", codex_cli_simplified_flow: "true", originator: "neura" }).toString();
        onAuthorize(url.href);
        const code = await callback;
        const credential = await tokenRequest(new URLSearchParams({ grant_type: "authorization_code", client_id: CLIENT_ID, code, code_verifier: verifier, redirect_uri: redirect }), AbortSignal.any([operation.signal, AbortSignal.timeout(15_000)]));
        await save(root, credential, operation.signal);
      } finally {
        operation.signal.removeEventListener("abort", abort);
        server.closeAllConnections();
        if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }));
  } finally { active.delete(operation.controller); }
}

/** Local logout only; no undocumented remote revocation request. */
export async function logoutCodex(): Promise<void> {
  for (const controller of active) controller.abort(new DOMException("Subscription authentication cancelled", "AbortError"));
  await serialize(async () => {
    try {
      await locked(false, async (root) => {
        const filename = path.join(root, "codex-auth.json");
        await unlinked(filename, false);
        await unlink(filename);
      });
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  });
}

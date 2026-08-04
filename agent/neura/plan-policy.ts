import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { isIP } from "node:net";
import * as path from "node:path";

export const PUBLISH_PLAN_TOOL = "publish_plan";
export const PLAN_ARTIFACT_ENTRY = "neura-plan-artifact";
export const MAX_PLAN_HTML_BYTES = 512 * 1024;
export const MAX_PLAN_INPUT_BYTES = 256 * 1024;

export const PLAN_MODE_TOOL_NAMES = Object.freeze([
  "read",
  "bash",
  "grep",
  "find",
  "ls",
  "questionnaire",
  "web_search",
  "web_fetch",
  PUBLISH_PLAN_TOOL,
]);

type PreparedPlanDirectory = {
  projectRoot: string;
  plansDir: string;
};

function inputRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
}

export function isSafePlanSlug(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 2
    && value.length <= 80
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export function planFilename(slug: string, suffix = 1): string {
  if (!isSafePlanSlug(slug)) throw new Error("Plan slug must use 2-80 lowercase letters, numbers, and single hyphens.");
  return `${slug}-plan${suffix > 1 ? `-${suffix}` : ""}.html`;
}

export function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function findProjectRoot(cwdInput: string): string {
  const start = typeof cwdInput === "string" && cwdInput.trim() ? cwdInput : process.cwd();
  let current: string;
  try { current = fs.realpathSync(start); }
  catch { current = path.resolve(start); }
  const fallback = current;

  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return fallback;
    current = parent;
  }
}

async function assertDirectoryIsReal(directory: string, label: string): Promise<string> {
  const stat = await fsp.lstat(directory);
  if (stat.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link or junction.`);
  if (!stat.isDirectory()) throw new Error(`${label} must be a directory.`);
  return fsp.realpath(directory);
}

export async function preparePlanDirectory(cwd: string): Promise<PreparedPlanDirectory> {
  const rootCandidate = findProjectRoot(cwd);
  const projectRoot = await assertDirectoryIsReal(rootCandidate, "Project root");
  const plansCandidate = path.join(projectRoot, "plans");

  try {
    await fsp.mkdir(plansCandidate, { recursive: false });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code !== "EEXIST") throw error;
  }

  const plansDir = await assertDirectoryIsReal(plansCandidate, "Plan directory");
  if (!isPathInside(projectRoot, plansDir) || path.dirname(plansDir) !== projectRoot) {
    throw new Error("Plan directory resolved outside the project root.");
  }
  return { projectRoot, plansDir };
}

export async function nextAvailablePlanPath(plansDir: string, slug: string): Promise<string> {
  for (let suffix = 1; suffix <= 100; suffix++) {
    const candidate = path.join(plansDir, planFilename(slug, suffix));
    if (!isPathInside(plansDir, candidate) || path.dirname(candidate) !== plansDir) {
      throw new Error("Plan destination escaped the plan directory.");
    }
    try { await fsp.lstat(candidate); }
    catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (code === "ENOENT") return candidate;
      throw error;
    }
  }
  throw new Error("Plan filename collision limit reached. Choose a more specific slug.");
}

export async function assertOwnedPlanPath(plansDir: string, candidate: string): Promise<void> {
  const resolved = path.resolve(candidate);
  if (!isPathInside(plansDir, resolved) || path.dirname(resolved) !== plansDir || path.extname(resolved).toLowerCase() !== ".html") {
    throw new Error("Owned plan path no longer belongs to this project plan directory.");
  }
  const stat = await fsp.lstat(resolved);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Owned plan must remain a regular HTML file.");
  if (stat.size > MAX_PLAN_HTML_BYTES) throw new Error("Owned plan exceeds the Plan mode size limit.");
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [a, b] = parts.map(Number);
  return a === 0
    || a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || a >= 224;
}

export function isSafeExternalUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
    if (url.port && !((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443"))) return false;
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const ipv6 = isIP(hostname) === 6;
    if (!hostname
      || !hostname.includes(".") && !ipv6
      || hostname === "localhost"
      || hostname.endsWith(".localhost")
      || hostname.endsWith(".local")
      || hostname.endsWith(".internal")
      || hostname.endsWith(".lan")
      || hostname === "::"
      || hostname === "::1"
      || hostname.startsWith("fe80:")
      || (ipv6 && (hostname.startsWith("fc") || hostname.startsWith("fd")))
      || (ipv6 && hostname.includes("ffff:"))
      || isPrivateIpv4(hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

export function isPlanToolInputAllowed(toolName: string, input: unknown): boolean {
  const data = inputRecord(input);
  if (toolName === PUBLISH_PLAN_TOOL) return isSafePlanSlug(data.slug);
  if (toolName === "web_search") {
    const query = data.query;
    const maxResults = data.max_results;
    return typeof query === "string"
      && query.trim().length >= 2
      && query.length <= 500
      && (maxResults === undefined || (Number.isInteger(maxResults) && Number(maxResults) >= 1 && Number(maxResults) <= 10));
  }
  if (toolName === "web_fetch") return isSafeExternalUrl(data.url);
  return true;
}

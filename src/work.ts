import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { Type } from 'typebox';
import { z } from 'zod';
import { inspectAction } from '../agent/neura/action-policy.ts';
import { SECRET_PATH, PROTECTED_CONTROL } from '../agent/neura/action-paths.ts';
import { readPlanFileSnapshot, inspectPlanFiles } from '../agent/neura/plan-files.ts';
import { runInHumanAwaySandbox } from '../agent/neura/human-away-sandbox.ts';
import { redactSensitiveText } from '../agent/neura/redaction.ts';
import type { ToolDefinition } from './runtime.ts';

const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const inside = (root: string, file: string) => { const relative = path.relative(root, file); return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
export type WorkApproval = (description: string) => Promise<boolean>;
export function assertWorkspaceOutsideNeuraHome(workspace: string, home = process.env.NEURA_HOME || path.join(os.homedir(), '.neura')): void {
  const root = fs.realpathSync.native(workspace);
  if (root.split(/[\\/]/).some(part => part.replace(/[. ]+$/, '').toLowerCase() === '.pi')) throw new Error('The legacy Pi profile cannot be a Neura workspace. Choose a separate project directory.');
  let ancestor = path.resolve(home); const suffix: string[] = [];
  let privateRoot: string;
  for (;;) {
    try {
      const stat = fs.lstatSync(ancestor);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Linked or non-directory Neura home ancestors are forbidden.');
      privateRoot = path.join(fs.realpathSync.native(ancestor), ...suffix); break;
    } catch (error) {
      const parent = path.dirname(ancestor);
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || parent === ancestor) throw error;
      suffix.unshift(path.basename(ancestor)); ancestor = parent;
    }
  }
  if (path.relative(root, privateRoot) === '' || inside(root, privateRoot) || inside(privateRoot, root)) throw new Error('Workspace must not overlap the private Neura home. Choose a separate project directory and NEURA_HOME.');
}
export const WORK_INSTRUCTIONS = `You are Neura, a practical engineering assistant. Work is supervised. Inspect before editing; preserve unrelated user changes. Read returns a SHA-256 hash: write requires that exact hash for an existing file, or null for a new file. Edits must replace one exact occurrence. If read reports editable:false, hidden/redacted bytes require an external manual edit; do not rewrite placeholders. Commands require interactive confirmation and run only in network-disabled WSL2/bubblewrap, with no host fallback. Never claim verification without actual passing evidence; /ship is not implemented in this v1. Protected/private/control files and remote operations are unavailable. Neura cannot rewrite its own runtime or execute commands against its own checkout; request an external manual terminal for that. Explain unavailable tools honestly. Do not invent Plan, YOLO, Human Away, integration or delegation support.`;

export function createWorkspaceTools(workspace: string, mode: () => 'work' | 'learn', generation: () => number, approve: WorkApproval = async () => false): ToolDefinition[] {
  const exposed = generation();
  const root = fs.realpathSync.native(workspace);
  assertWorkspaceOutsideNeuraHome(root);
  const applicationRoot = fs.realpathSync.native(new URL('..', import.meta.url));
  const ownsControlPlane = path.relative(applicationRoot, root) === '' || inside(applicationRoot, root) || inside(root, applicationRoot);
  function check(signal?: AbortSignal, workOnly = false) {
    signal?.throwIfAborted();
    if (generation() !== exposed || (workOnly && mode() !== 'work')) throw new Error('Mode/session changed; stale tool authority rejected.');
  }
  function tool(name: string, description: string, parameters: any, execute: (params: any, signal?: AbortSignal) => Promise<any>): ToolDefinition {
    const schema = z.fromJSONSchema(parameters);
    return { name, description, parameters, async execute(input, { signal }) {
      check(signal, !['read', 'ls'].includes(name));
      return { content: [{ type: 'text', text: JSON.stringify(await execute(schema.parse(input), signal)) }] };
    } };
  }
  function fileTarget(requested: string): string {
    if (!requested || requested.length > 1024 || /[\x00-\x1f\x7f:*?"<>|\[\]{}]/.test(requested) || /^[@~]|^[\\/]{2}/.test(requested)) throw new Error('Use a concrete workspace-relative file path.');
    const parts = requested.split(/[\\/]/);
    if (parts.some(part => !part || part === '..' || part.startsWith('.') || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i.test(part) || /^(?:node_modules|sessions|approvals|memory|private|secrets)$/i.test(part))) throw new Error('Private, ambiguous or dependency path denied.');
    const file = path.resolve(root, requested);
    function authorizeTarget(target: string) {
      const relative = path.relative(root, target);
      if (!inside(root, target) || SECRET_PATH.test('/' + relative) || PROTECTED_CONTROL.test(relative)) throw new Error('Protected or outside-workspace file denied.');
      // Apply the same control-plane policy to lexical and native canonical identities.
      if (inside(applicationRoot, target) && /^(?:(?:src|scripts|agent|launcher)[\\/]|package(?:-lock)?\.json$|tsconfig(?:\.v1)?\.json$|AGENTS\.md$|SECURITY\.md$)/i.test(path.relative(applicationRoot, target))) throw new Error('Neura control-plane edits require manual review outside the agent.');
    }
    authorizeTarget(file);
    let current = root;
    for (const part of parts.slice(0, -1)) {
      current = path.join(current, part);
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Linked parent denied.');
    }
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || !inside(root, fs.realpathSync.native(file))) throw new Error('Target must be an unlinked regular file.');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const canonical = fs.existsSync(file) ? fs.realpathSync.native(file) : path.join(fs.realpathSync.native(path.dirname(file)), path.basename(file));
    authorizeTarget(canonical);
    return canonical;
  }
  function commit(requested: string, content: string, expectedHash: string | null, signal?: AbortSignal) {
    check(signal, true);
    if (Buffer.byteLength(content) > 1024 * 1024) throw new Error('Write exceeds 1 MiB.');
    const file = fileTarget(requested);
    const current = fs.existsSync(file) ? readPlanFileSnapshot(root, requested) : undefined;
    if ((current?.sha256 ?? null) !== expectedHash) throw new Error('File changed or expectedHash is missing. Read again before writing.');
    if (current?.redacted) throw new Error('File contains redacted values; use an external manual edit to preserve hidden bytes.');
    const action = inspectAction({ toolName: 'write', input: { path: requested, content } }, root);
    if (action.route !== 'allow') throw new Error(`Write unavailable: ${action.reason}`);
    const temporary = path.join(path.dirname(file), `.neura-write-${randomUUID()}`);
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    try {
      check(signal, true); fileTarget(requested);
      const fresh = fs.existsSync(file) ? readPlanFileSnapshot(root, requested) : undefined;
      if ((fresh?.sha256 ?? null) !== expectedHash) throw new Error('File changed before commit; nothing replaced.');
      if (fresh?.redacted) throw new Error('File now contains redacted values; external manual edit required.');
      if (expectedHash === null) {
        // Hard-link publication has exclusive-create semantics; rename would overwrite a new human file.
        fs.linkSync(temporary, file); fs.unlinkSync(temporary);
      } else fs.renameSync(temporary, file);
      return { path: requested, sha256: hash(content), bytes: Buffer.byteLength(content) };
    } finally {
      try { fs.unlinkSync(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  }
  const tools = [
    tool('read', 'Read a non-private workspace file and its SHA-256 hash. Use the hash for a subsequent write.', Type.Object({ path: Type.String({ minLength: 1, maxLength: 1024 }) }, { additionalProperties: false }), async (params, signal) => {
      check(signal); const snapshot = readPlanFileSnapshot(root, params.path);
      if (snapshot.byteLength > 1024 * 1024) throw new Error('Read exceeds 1 MiB.');
      return { path: params.path, sha256: snapshot.sha256, text: redactSensitiveText(snapshot.content.toString('utf8'), 1024 * 1024), redacted: snapshot.redacted, editable: !snapshot.redacted };
    }),
    tool('ls', 'List bounded, non-private workspace entries.', Type.Object({ path: Type.String({ minLength: 1, maxLength: 1024 }) }, { additionalProperties: false }), async (params, signal) => {
      const text = await inspectPlanFiles(root, 'ls', params, signal); check(signal); return { entries: text };
    }),
  ];
  if (mode() === 'work') tools.push(
    tool('write', 'Write one ordinary workspace file. expectedHash is its last read SHA-256, or null for a new file. Parent directory must exist.', Type.Object({ path: Type.String({ minLength: 1, maxLength: 1024 }), content: Type.String({ maxLength: 1024 * 1024 }), expectedHash: Type.Union([Type.String({ pattern: '^[a-f0-9]{64}$' }), Type.Null()]) }, { additionalProperties: false }), async (params, signal) => commit(params.path, params.content, params.expectedHash, signal)),
    tool('edit', 'Replace exactly one matching text occurrence in an ordinary workspace file; stale hash or ambiguous matches fail.', Type.Object({ path: Type.String({ minLength: 1, maxLength: 1024 }), old_string: Type.String({ minLength: 1, maxLength: 1024 * 1024 }), new_string: Type.String({ maxLength: 1024 * 1024 }), expectedHash: Type.String({ pattern: '^[a-f0-9]{64}$' }) }, { additionalProperties: false }), async (params, signal) => {
      fileTarget(params.path);
      const snapshot = readPlanFileSnapshot(root, params.path);
      if (snapshot.redacted) throw new Error('File contains redacted values; use an external manual edit to preserve hidden bytes.');
      const content = snapshot.content.toString('utf8');
      const start = content.indexOf(params.old_string);
      if (start < 0 || content.indexOf(params.old_string, start + 1) >= 0) throw new Error('Edit text must match exactly once.');
      return commit(params.path, content.slice(0, start) + params.new_string + content.slice(start + params.old_string.length), params.expectedHash, signal);
    }),
    tool('work_exec', 'Run a confirmed command inside network-disabled WSL2/bubblewrap only. No host fallback. Protected, private and remote actions are unavailable.', Type.Object({ command: Type.String({ minLength: 1, maxLength: 8000 }), timeoutMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 120000 })) }, { additionalProperties: false }), async (params, signal) => {
      if (ownsControlPlane) throw new Error('Sandbox commands against Neura itself are unavailable: opaque commands could rewrite its running control plane. Use an external manual terminal.');
      const action = inspectAction({ toolName: 'work_exec', input: params }, root);
      if (action.route === 'deny' || ['protected-data', 'protected-control', 'remote-mutation', 'broad-destruction'].includes(action.category)) throw new Error(`Command unavailable in v1: ${action.reason}`);
      if (!await approve(`Run in network-disabled WSL sandbox?\n${redactSensitiveText(params.command, 8000)}\nTimeout: ${params.timeoutMs ?? 120000} ms\nApproval applies once to this exact action.`)) throw new Error('Command denied; no execution.');
      check(signal, true);
      const fresh = inspectAction({ toolName: 'work_exec', input: params }, root);
      if (fresh.actionFingerprint !== action.actionFingerprint || fresh.workspaceFingerprint !== action.workspaceFingerprint || JSON.stringify(fresh.approvalBinding) !== JSON.stringify(action.approvalBinding)) throw new Error('Action/workspace changed after approval; confirm again.');
      const outcome = await runInHumanAwaySandbox(root, params.command, params.timeoutMs ?? 120000, signal);
      check(signal, true);
      return { ...outcome, isolation: 'WSL2/bubblewrap; no network', verification: 'Command outcome only, not a full proof receipt.' };
    }),
  );
  return tools;
}

#!/usr/bin/env node
// ACP v1 local-command adapter. No Pi, client-side shell, implicit login or API fallback.
import { stdin, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { main, type CliBridge } from './cli.ts';
import { redactSensitiveText } from '../agent/neura/redaction.ts';

const version = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const MODES = { currentModeId: 'work', availableModes: [{ id: 'work', name: 'Work' }, { id: 'learn', name: 'Learn' }] };
const MAX_FRAME = 256 * 1024;
type Controller = Parameters<CliBridge['serve']>[0];
type Session = { controller: Controller; done: Promise<void>; close: () => void; busy: boolean; cancelled: boolean; active?: Promise<unknown>; stepLimit: boolean; currentTool?: string };
type Frame = { jsonrpc: string; id?: string | number | null; method?: string; params?: any; result?: any; error?: unknown };
class RpcError extends Error {
  code: number;
  constructor(code: number, message: string) { super(message); this.code = code; }
}

/** Exported for pipe-based protocol regression tests; stdout contains JSON-RPC only. */
export function serveAcp(input = stdin, output = stdout) {
  let initialized = false;
  let providerProbe = false;
  let closed = false;
  let buffer = '';
  const sessions = new Map<string, Session>();
  const opening = new Set<Promise<unknown>>();
  const pending = new Map<string, { sessionId: string; resolve: (value: boolean) => void }>();
  const send = (frame: object) => { if (!closed) output.write(JSON.stringify({ jsonrpc: '2.0', ...frame }) + '\n'); };
  const update = (sessionId: string, text: string) => {
    if (text) send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } } });
  };
  const cancel = (sessionId: string) => {
    const session = sessions.get(sessionId);
    if (session) { session.cancelled = true; session.controller.cancel(); }
    for (const [id, request] of pending) if (request.sessionId === sessionId) { pending.delete(id); request.resolve(false); }
  };
  const approve = async (sessionId: string, description: string): Promise<boolean> => {
    const session = sessions.get(sessionId);
    if (closed || !session?.busy || session.cancelled || description.length > 32768) return false;
    const id = `permission-${randomUUID()}`;
    return new Promise<boolean>(resolve => {
      const timer = setTimeout(() => { pending.delete(id); resolve(false); }, 300_000);
      pending.set(id, { sessionId, resolve: value => { clearTimeout(timer); resolve(value); } });
      send({ id, method: 'session/request_permission', params: {
        sessionId, toolCall: { toolCallId: session.currentTool ?? id, title: 'Approve this exact Neura action', kind: 'other', status: 'pending',
          rawInput: { description: redactSensitiveText(description, 32768) },
          content: [{ type: 'content', content: { type: 'text', text: redactSensitiveText(description, 32768) } }] },
        options: [{ optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' }, { optionId: 'reject_once', name: 'Reject', kind: 'reject_once' }],
      } });
    });
  };
  const getSession = (params: any): [string, Session] => {
    if (!params || typeof params.sessionId !== 'string' || !sessions.has(params.sessionId)) throw new RpcError(-32602, 'Unknown session');
    return [params.sessionId, sessions.get(params.sessionId)!];
  };
  async function dispatch(method: string, params: any) {
    if (method === 'initialize') {
      if (initialized || !Number.isSafeInteger(params?.protocolVersion)) throw new RpcError(-32602, 'Invalid initialization');
      initialized = true;
      providerProbe = params.clientInfo?.name === 't3-code-provider-test';
      return { protocolVersion: 1, agentInfo: { name: 'neura', title: 'Neura (development)', version },
        agentCapabilities: { loadSession: false, promptCapabilities: {}, mcpCapabilities: {} }, authMethods: [] };
    }
    if (!initialized) throw new RpcError(-32000, 'Initialize first');
    if (providerProbe && ['session/prompt', 'session/set_mode'].includes(method)) throw new RpcError(-32601, 'Provider discovery cannot run tasks');
    if (method === 'session/new') {
      // ponytail: one native session per process; T3 starts one process per thread.
      if (sessions.size || opening.size) throw new RpcError(-32000, 'This process already owns a session');
      if (!params || typeof params.cwd !== 'string' || !path.isAbsolute(params.cwd) || !Array.isArray(params.mcpServers)) throw new RpcError(-32602, 'An absolute cwd and mcpServers array are required');
      const sessionId = randomUUID();
      let close!: () => void;
      const lifetime = new Promise<void>(resolve => { close = resolve; });
      let ready!: (controller: Controller) => void;
      let failed!: (error: unknown) => void;
      const started = new Promise<Controller>((resolve, reject) => { ready = resolve; failed = reject; });
      const toolCalls = new Set<string>();
      // T3 discovery uses its host cwd, which may contain the private account store.
      // Exercise the real CLI in an empty disposable workspace, never that directory.
      const probeWorkspace = providerProbe ? fs.mkdtempSync(path.join(os.tmpdir(), 'neura-acp-probe-')) : undefined;
      const done = main(['--cwd', probeWorkspace ?? params.cwd, ...(providerProbe ? ['--no-history'] : [])], {
        write: text => update(sessionId, text), approve: text => approve(sessionId, text),
        onStepLimit: () => { const session = sessions.get(sessionId); if (session) session.stepLimit = true; },
        onReasoning: text => send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text } } } }),
        onToolEvent: (event, invocationId) => {
          // Model requests may arrive in a batch. Cards follow runtime-owned invocations, not request order.
          if (event.phase === 'requested') return;
          const toolCallId = invocationId ?? randomUUID();
          const first = !toolCalls.has(toolCallId);
          toolCalls.add(toolCallId);
          const session = sessions.get(sessionId);
          if (session) session.currentTool = event.phase === 'started' ? toolCallId : undefined;
          const status = event.phase === 'started' ? 'in_progress' : event.phase === 'returned' ? 'completed' : 'failed';
          send({ method: 'session/update', params: { sessionId, update: { sessionUpdate: first ? 'tool_call' : 'tool_call_update', toolCallId,
            ...(first ? { title: event.toolName, kind: 'other' } : {}), status } } });
          if (event.phase !== 'started') toolCalls.delete(toolCallId);
        },
        serve: async controller => { ready(controller); await lifetime; },
      }).finally(() => { if (probeWorkspace) fs.rmdirSync(probeWorkspace); });
      void done.catch(failed);
      opening.add(started);
      let controller: Controller;
      try { controller = await started; } finally { opening.delete(started); }
      sessions.set(sessionId, { controller, done, close, busy: false, cancelled: false, stepLimit: false });
      if (closed) { close(); return {}; }
      if (params.mcpServers.length) update(sessionId, 'Neura development adapter: external MCP servers are not connected. Neura-owned tools and sandbox remain active.\n');
      const modelId = process.env.NEURA_MODEL || 'default';
      return { sessionId, modes: MODES, models: { currentModelId: modelId, availableModels: [{ modelId, name: process.env.NEURA_MODEL || 'Neura subscription default' }] } };
    }
    if (method === 'session/cancel') { const [id] = getSession(params); cancel(id); return {}; }
    if (method === 'session/set_model') {
      getSession(params);
      if (params.modelId !== (process.env.NEURA_MODEL || 'default')) throw new RpcError(-32602, 'Configure NEURA_MODEL in this provider instance before starting a new thread');
      return {};
    }
    if (method === 'session/set_mode') {
      const [id, session] = getSession(params);
      if (!['work', 'learn'].includes(params.modeId)) throw new RpcError(-32602, 'Only Work and Learn are available');
      if (session.busy) throw new RpcError(-32000, 'Wait for the active turn before changing modes');
      await session.controller.execute(`/mode ${params.modeId}`);
      send({ method: 'session/update', params: { sessionId: id, update: { sessionUpdate: 'current_mode_update', currentModeId: params.modeId } } });
      return {};
    }
    if (method === 'session/prompt') {
      const [id, session] = getSession(params);
      if (session.busy) throw new RpcError(-32000, 'A turn is already running');
      if (!Array.isArray(params.prompt) || !params.prompt.length) throw new RpcError(-32602, 'A text prompt is required');
      const text = params.prompt.map((part: any) => {
        if (part?.type === 'text' && typeof part.text === 'string') return part.text;
        // Links are references, never permission to fetch a URL or read an external path.
        if (part?.type === 'resource_link' && typeof part.uri === 'string') return `[Resource reference: ${part.uri}]`;
        throw new RpcError(-32602, 'Images, audio and embedded resources are not supported');
      }).join('\n');
      if (!text.trim() || text.length > 32000) throw new RpcError(-32602, 'Task must contain 1-32000 characters');
      if (/^\/(?:login|logout|new|resume|sessions|model|quit|exit)(?:\s|$)/.test(text)) throw new RpcError(-32602, 'Use the native Neura terminal for account, model and history management');
      session.busy = true; session.cancelled = false; session.stepLimit = false;
      try {
        session.active = session.controller.execute(text);
        await session.active;
        return { stopReason: session.cancelled ? 'cancelled' : session.stepLimit ? 'max_turn_requests' : 'end_turn' };
      } catch (error) {
        if (session.cancelled) return { stopReason: 'cancelled' };
        throw error;
      } finally { session.busy = false; session.active = undefined; cancel(id); }
    }
    throw new RpcError(-32601, 'Method not found');
  }
  async function receive(line: string) {
    let frame: Frame;
    try { frame = JSON.parse(line); }
    catch { send({ id: null, error: { code: -32700, message: 'Parse error' } }); return; }
    if (!frame || frame.jsonrpc !== '2.0' || (frame.id !== undefined && frame.id !== null && typeof frame.id !== 'string' && typeof frame.id !== 'number')) {
      send({ id: null, error: { code: -32600, message: 'Invalid request' } }); return;
    }
    if (!frame.method) {
      const request = typeof frame.id === 'string' ? pending.get(frame.id) : undefined;
      if (request) {
        pending.delete(frame.id as string);
        const outcome = frame.result?.outcome;
        request.resolve(!frame.error && outcome?.outcome === 'selected' && outcome.optionId === 'allow_once');
      }
      return;
    }
    try {
      const result = await dispatch(frame.method, frame.params);
      if (frame.id !== undefined) send({ id: frame.id, result });
    } catch (error) {
      if (frame.id !== undefined) send({ id: frame.id, error: { code: error instanceof RpcError ? error.code : -32603,
        message: error instanceof RpcError ? error.message : 'Neura request failed. Inspect local configuration; no task was replayed.' } });
    }
  }
  const close = () => {
    if (closed) return;
    closed = true;
    for (const [id, session] of sessions) {
      cancel(id);
      // Release the native writer lease only after an interrupted effect has settled.
      void Promise.resolve(session.active).catch(() => undefined).then(session.close);
    }
  };
  input.setEncoding('utf8');
  input.on('data', (chunk: string) => {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > MAX_FRAME) { close(); input.pause(); return; }
    let index: number;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      if (line.trim()) void receive(line);
    }
  });
  input.once('end', close); input.once('error', close);
  output.once('error', () => { close(); input.destroy(); });
  return { close };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) serveAcp();

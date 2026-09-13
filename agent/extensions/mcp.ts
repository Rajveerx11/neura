import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { acquireHostOperation } from "../neura/mode-state.ts";

function hasSelectedMcpTool(event: { systemPromptOptions?: { selectedTools?: string[] } }): boolean {
  return event.systemPromptOptions?.selectedTools?.some((name) => name.startsWith("mcp__")) ?? false;
}

export function mcpModuleSpecifier(agentDir: string, exists = fs.existsSync): string {
  const installed = path.join(agentDir, "npm", "node_modules", "@spences10", "pi-mcp", "dist", "index.js");
  return exists(installed) ? pathToFileURL(installed).href : "@spences10/pi-mcp";
}

async function withoutEagerConnect<T>(action: () => T | Promise<T>): Promise<T> {
  const eager = process.env.MY_PI_MCP_EAGER_CONNECT;
  delete process.env.MY_PI_MCP_EAGER_CONNECT;
  try { return await action(); }
  finally {
    if (eager === undefined) delete process.env.MY_PI_MCP_EAGER_CONNECT;
    else process.env.MY_PI_MCP_EAGER_CONNECT = eager;
  }
}

async function withYoloLease<T>(action: () => T | Promise<T>): Promise<T | undefined> {
  const release = acquireHostOperation();
  if (!release) return;
  try { return await action(); }
  finally { release(); }
}

export default async function (pi: ExtensionAPI): Promise<void> {
  const { default: mcp } = await import(mcpModuleSpecifier(getAgentDir()));
  if (!process.env.NEURA) {
    await mcp(pi);
    return;
  }
  await withoutEagerConnect(() => mcp(new Proxy(pi, {
    get(target, property, receiver) {
      if (property === "on") return ((event: string, handler: (request: any, ctx: any) => unknown) => (target.on as any)(event, event === "before_agent_start"
        ? ((request, ctx) => hasSelectedMcpTool(request) ? withYoloLease(() => handler(request, ctx)) : undefined)
        : event === "session_start"
          ? ((request, ctx) => withoutEagerConnect(() => handler(request, ctx)))
        : handler)) as ExtensionAPI["on"];
      if (property === "registerCommand") return ((name: string, options: any) => (target.registerCommand as any)(name, name === "mcp" ? {
        ...options,
        handler: async (args, ctx) => {
          const release = acquireHostOperation();
          if (!release) return void ctx.ui.notify("MCP connection is available only in YOLO mode.", "warning");
          try { return await options.handler(args, ctx); }
          finally { release(); }
        },
      } : options)) as ExtensionAPI["registerCommand"];
      return Reflect.get(target, property, receiver);
    },
  })));
}

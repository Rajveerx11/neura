// October context-bus extension (auto-generated; Neura adds one Human Away privacy gate).
import { getMode } from '../neura/mode-state.ts'
export default async function (pi) {
  const PORT = process.env.OCTOBER_BUS_PORT
  const CANVAS = process.env.OCTOBER_BUS_CANVAS
  const NODE = process.env.OCTOBER_BUS_NODE
  if (!PORT || !CANVAS || !NODE) return
  if (process.env.CAMPFIRE_SESSION_ROLE && process.env.CAMPFIRE_SESSION_ROLE !== 'host') return
  const base = 'http://127.0.0.1:' + PORT

  const post = async (path, body) => {
    try {
      const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      try { return await r.json() } catch { return null }
    } catch { return null /* bus not up — ignore */ }
  }
  const pull = async () => {
    try {
      const r = await fetch(base + '/hook/pre-prompt?canvas=' + encodeURIComponent(CANVAS) + '&node=' + encodeURIComponent(NODE))
      return (await r.text()).trim()
    } catch { return '' }
  }
  const textOf = (content) => {
    if (typeof content === 'string') return content
    if (Array.isArray(content)) return content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n')
    return ''
  }

  pi.on('session_start', async (_event, ctx) => {
    if (getMode() === 'plan') return
    let session = ''
    try { session = ctx.sessionManager.getSessionId() || '' } catch { /* ignore */ }
    await post('/hook/session', { canvas: CANVAS, node: NODE, status: 'live', session, agent: 'pi' })
  })
  pi.on('session_shutdown', async () => {
    if (getMode() === 'plan') return
    await post('/hook/session', { canvas: CANVAS, node: NODE, status: 'offline', agent: 'pi' })
  })

  // before each user prompt: pull unread peer messages/context and ride along as a custom message
  pi.on('before_agent_start', async () => {
    const text = await pull()
    if (!text) return
    return { message: { customType: 'october-bus', content: text, display: true } }
  })

  // turn done → post the raw excerpt; October summarizes off the hot path
  pi.on('agent_end', async (event, ctx) => {
    if (getMode() !== 'yolo') return // no Plan mutation or unattended transcript export, even to localhost
    try {
      const msgs = Array.isArray(event.messages) ? event.messages : []
      let userPrompt = ''
      let assistantText = ''
      for (const m of msgs) {
        if (!m || !m.role) continue
        const t = textOf(m.content)
        if (!t.trim()) continue
        if (m.role === 'user') { userPrompt = t; assistantText = '' } // new turn → reset
        else if (m.role === 'assistant') assistantText += (assistantText ? '\n' : '') + t
      }
      if (!assistantText.trim()) return
      await post('/hook/stop', {
        canvas: CANVAS,
        node: NODE,
        agent: 'pi',
        excerpt: {
          cwd: ctx && ctx.cwd,
          userPrompt: userPrompt.slice(0, 6000),
          assistantText: assistantText.slice(0, 12000),
          toolsUsed: [],
          filesTouched: []
        }
      })
    } catch { /* ignore */ }
  })

  // pi's reply path: a native tool that POSTs to the bus bridge (pi has no MCP client).
  // Description kept verbatim from the MCP message_peer tool — the reply discipline in it is
  // what lets a multi-agent loop end (silence ends a loop).
  try {
    const { Type } = await import('typebox')
    pi.registerTool({
      name: 'message_peer',
      label: 'Message peer',
      description:
        'Talk to a connected peer agent — address them by name (e.g. "Marshall"). This is the one way you reach a peer: ask a question, answer one, hand off a task, share a finding, debate, or just reply. Your message is delivered VERBATIM in real time and the peer responds on its own — no need to phrase it as a command. Address them by name (check the peer roster in your injected context if unsure who is connected); reply to a peer who messaged you by sending back to their name. Only reach out when you have something substantive — a real answer, a needed question, or work to hand off. If an exchange is going in circles, or your task is done and there is nothing to pass on, send nothing: staying silent is how a multi-agent loop is meant to end.',
      parameters: Type.Object({
        peer: Type.String({ description: 'the peer agent name (e.g. "Marshall") or kind ("terminal"/"chat")' }),
        message: Type.String({ description: 'what to say — your exact words, delivered verbatim' })
      }),
      async execute(_toolCallId, params) {
        const r = await post('/hook/message-peer', { canvas: CANVAS, node: NODE, peer: params.peer, message: params.message })
        const ok = !!(r && r.ok)
        const text = ok ? 'Sent to ' + params.peer + '.' : 'Could not send: ' + ((r && r.reason) || 'bus unreachable')
        return { content: [{ type: 'text', text }], details: {} }
      }
    })

    // the shared task board (same four verbs the MCP harnesses get; served by /hook/task so
    // wording and behavior are identical — see server.ts runTaskOp)
    const taskTool = (name, label, description, parameters, toBody) => {
      pi.registerTool({
        name,
        label,
        description,
        parameters,
        async execute(_toolCallId, params) {
          const r = await post('/hook/task', { canvas: CANVAS, node: NODE, ...toBody(params || {}) })
          const text = (r && r.text) || 'bus unreachable'
          return { content: [{ type: 'text', text }], details: {} }
        }
      })
    }
    taskTool(
      'add_task',
      'Add board task',
      'Post a task to this canvas’s shared board for any connected agent (including yourself) to pick up. Use it to break work into parallelizable pieces or to hand off follow-ups without addressing a specific peer. Keep the description self-contained — the claimer may have none of your context. Optional "after" lists task ids that must finish first (the task stays blocked until they do). Returns the new task id.',
      Type.Object({
        description: Type.String({ description: 'what needs doing — self-contained, actionable' }),
        after: Type.Optional(Type.Array(Type.String(), { description: 'task ids that must complete before this one is claimable' }))
      }),
      (p) => ({ op: 'add', description: p.description, after: p.after })
    )
    taskTool(
      'claim_task',
      'Claim board task',
      'Claim a task from the shared board before working on it. Claims converge last-write-wins across machines; a simultaneous claim elsewhere may win, so re-check claimedBy after sync if it matters. Call with a task id, or with no id to claim the oldest unblocked open task. Do the work, then call complete_task. A claim held by an offline agent can be re-claimed.',
      Type.Object({ id: Type.Optional(Type.String({ description: 'task id to claim; omit for the next available task' })) }),
      (p) => ({ op: 'claim', id: p.id })
    )
    taskTool(
      'complete_task',
      'Complete board task',
      'Mark a board task done, optionally with a short note of the outcome (where the result lives, anything the next task needs). Completing a task automatically unblocks tasks that depended on it. Only complete work that is actually done and verified.',
      Type.Object({
        id: Type.String({ description: 'the task id' }),
        note: Type.Optional(Type.String({ description: 'one-line outcome — where the result is, caveats' }))
      }),
      (p) => ({ op: 'complete', id: p.id, note: p.note })
    )
    taskTool(
      'list_tasks',
      'List board tasks',
      'See this canvas’s shared task board: every task with its status (open / claimed / done), who claimed it, and whether it’s still blocked by dependencies. Check it when you finish something or have spare capacity — unclaimed open tasks are work anyone can pick up with claim_task.',
      Type.Object({}),
      () => ({ op: 'list' })
    )
  } catch { /* typebox virtual module unavailable (old pi) — runs without the tools */ }
}

import type { NativeActivityItem, NativeActivityState } from '../../shared/activity'

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function upsert(items: NativeActivityItem[], item: NativeActivityItem): NativeActivityItem[] {
  const previous = items.find(value => value.id === item.id)
  return [...items.filter(value => value.id !== item.id), { ...previous, ...item }].slice(-1024)
}

function plan(values: unknown, codex = false): NonNullable<NativeActivityState['plan']> {
  if (!Array.isArray(values) || values.length > 1024)
    throw new Error('Native plan is not a bounded array')
  return { steps: values.map((value) => {
    const item = object(value)
    const content = codex ? item.step : item.content
    const status = item.status === 'inProgress' ? 'in_progress' : item.status
    if (typeof content !== 'string' || !['pending', 'in_progress', 'completed'].includes(String(status)))
      throw new Error('Native plan step is invalid')
    return { content, status: status as 'pending' | 'in_progress' | 'completed' }
  }) }
}

export function reduceActivity(state: NativeActivityState, backend: 'codex' | 'claude', message: Record<string, unknown>, pending: Map<string, NativeActivityState['plan']>): NativeActivityState | undefined {
  if (backend === 'codex') {
    const params = object(message.params)
    if (message.method === 'turn/plan/updated') {
      const next = plan(params.plan, true)
      if (typeof params.explanation === 'string')
        next.explanation = params.explanation
      return { ...state, plan: next, unavailable: { ...state.unavailable, plan: null } }
    }
    if (message.method !== 'item/started' && message.method !== 'item/completed')
      return undefined
    const item = object(params.item)
    if (item.type === 'subAgentActivity') {
      const id = text(item.agentThreadId)
      if (!id)
        throw new Error('Native agent identity is missing')
      return { ...state, subagents: upsert(state.subagents, { id, ...text(item.agentPath) ? { label: String(item.agentPath) } : {}, ...text(item.kind) ? { status: String(item.kind) } : {} }), unavailable: { ...state.unavailable, subagents: null } }
    }
    if (item.type === 'collabAgentToolCall') {
      const agents = object(item.agentsStates)
      if (!Array.isArray(item.receiverThreadIds))
        throw new Error('Native agent identities are missing')
      let subagents = state.subagents
      for (const id of item.receiverThreadIds) {
        if (typeof id !== 'string' || id === '')
          throw new Error('Native agent identity is invalid')
        const info = object(agents[id])
        subagents = upsert(subagents, { id, ...text(info.status) ? { status: String(info.status) } : {}, ...text(info.message) ? { details: String(info.message) } : {} })
      }
      return { ...state, subagents, unavailable: { ...state.unavailable, subagents: null } }
    }
    return undefined
  }
  if (message.type === 'system') {
    if (message.subtype === 'background_tasks_changed') {
      if (!Array.isArray(message.tasks) || message.tasks.length > 1024)
        throw new Error('Native background task snapshot is invalid')
      let jobs = state.jobs
      let subagents = state.subagents
      for (const value of message.tasks) {
        const task = object(value)
        const id = text(task.task_id)
        if (!id)
          throw new Error('Native background task identity is missing')
        const item = { id, ...text(task.description) ? { label: String(task.description) } : {}, ...text(task.parent_task_id) ? { parentId: String(task.parent_task_id) } : {} }
        jobs = upsert(jobs, item)
        if (task.task_type === 'local_agent')
          subagents = upsert(subagents, item)
      }
      return { ...state, jobs, subagents, unavailable: { ...state.unavailable, jobs: 'partial', ...subagents !== state.subagents ? { subagents: 'partial' } : {} } }
    }
    const id = text(message.task_id)
    if (!id || !['task_started', 'task_progress', 'task_updated', 'task_notification'].includes(String(message.subtype)))
      return undefined
    const patch = message.subtype === 'task_updated' ? object(message.patch) : message
    const status = text(patch.status)
    const label = text(patch.description)
    const details = text(patch.summary) ?? text(patch.last_tool_name)
    const item = { id, ...label ? { label } : {}, ...status ? { status } : {}, ...details ? { details } : {} }
    const jobs = patch.is_backgrounded === true || state.jobs.some(item => item.id === id) ? upsert(state.jobs, item) : state.jobs
    const subagents = message.task_type === 'local_agent' || message.task_type === 'remote_agent' || state.subagents.some(item => item.id === id) ? upsert(state.subagents, item) : state.subagents
    return { ...state, jobs, subagents, unavailable: { ...state.unavailable, ...jobs !== state.jobs ? { jobs: 'partial' } : {}, ...subagents !== state.subagents ? { subagents: 'partial' } : {} } }
  }
  const body = object(message.message)
  if (!Array.isArray(body.content) || message.parent_tool_use_id != null)
    return undefined
  let next: NativeActivityState | undefined
  for (const value of body.content) {
    const block = object(value)
    if (message.type === 'assistant' && block.type === 'tool_use' && block.name === 'TodoWrite') {
      const id = text(block.id)
      if (id) {
        if (pending.size >= 1024)
          pending.clear()
        pending.set(id, plan(object(block.input).todos))
      }
    }
    else if (message.type === 'user' && block.type === 'tool_result') {
      const id = text(block.tool_use_id)
      const current = id ? pending.get(id) : undefined
      if (id)
        pending.delete(id)
      if (current && block.is_error !== true)
        next = { ...(next ?? state), plan: current, unavailable: { ...(next ?? state).unavailable, plan: null } }
    }
  }
  return next
}

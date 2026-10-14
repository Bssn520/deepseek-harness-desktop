import type { NativeActivityState } from '../../shared/activity'
import { describe, expect, it } from 'vitest'
import { reduceActivity } from './activity.utils'

const empty: NativeActivityState = { plan: null, subagents: [], jobs: [], unavailable: { plan: 'not-exposed', subagents: 'not-exposed', jobs: 'not-exposed' } }

describe('native activity observation', () => {
  it('maps Codex plan statuses without changing the native notification', () => {
    const event = { method: 'turn/plan/updated', params: { plan: [{ step: 'Ship', status: 'inProgress' }], explanation: 'Now' } }
    const original = JSON.stringify(event)
    expect(reduceActivity(empty, 'codex', event, new Map())).toEqual({ ...empty, plan: { steps: [{ content: 'Ship', status: 'in_progress' }], explanation: 'Now' }, unavailable: { ...empty.unavailable, plan: null } })
    expect(JSON.stringify(event)).toBe(original)
  })

  it('retains native agent identities and reported statuses, without inventing child sessions', () => {
    const event = { method: 'item/completed', params: { item: { type: 'collabAgentToolCall', receiverThreadIds: ['native-a', 'native-b'], agentsStates: { 'native-a': { status: 'errored', message: 'Failure' } } } } }
    expect(reduceActivity(empty, 'codex', event, new Map())?.subagents).toEqual([{ id: 'native-a', status: 'errored', details: 'Failure' }, { id: 'native-b' }])
    expect(empty.subagents).toEqual([])
  })

  it('commits Claude todos only after the successful original tool result', () => {
    const pending = new Map<string, NativeActivityState['plan']>()
    const call = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'todo', name: 'TodoWrite', input: { todos: [{ content: 'Ship', status: 'pending' }] } }] } }
    expect(reduceActivity(empty, 'claude', call, pending)).toBeUndefined()
    expect(reduceActivity(empty, 'claude', { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'todo', is_error: true }] } }, pending)).toBeUndefined()
    reduceActivity(empty, 'claude', call, pending)
    const result = reduceActivity(empty, 'claude', { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'todo', content: 'unchanged' }] } }, pending)
    expect(result?.plan).toEqual({ steps: [{ content: 'Ship', status: 'pending' }] })
    expect(pending.size).toBe(0)
  })

  it('keeps task lifecycle facts and marks the incomplete task view as partial', () => {
    const start = reduceActivity(empty, 'claude', { type: 'system', subtype: 'task_started', task_id: 'task-a', task_type: 'local_agent', is_backgrounded: true, description: 'Inspect' }, new Map())!
    expect(start.jobs).toEqual([{ id: 'task-a', label: 'Inspect' }])
    expect(start.unavailable.jobs).toBe('partial')
    const end = reduceActivity(start, 'claude', { type: 'system', subtype: 'task_updated', task_id: 'task-a', patch: { status: 'completed' } }, new Map())!
    expect(end.subagents).toEqual([{ id: 'task-a', label: 'Inspect', status: 'completed' }])
  })

  it('does not mislabel a foreground agent as a background task or infer completion from snapshot absence', () => {
    const start = reduceActivity(empty, 'claude', { type: 'system', subtype: 'task_started', task_id: 'front', task_type: 'local_agent' }, new Map())!
    expect(start.jobs).toEqual([])
    expect(start.subagents).toEqual([{ id: 'front' }])
    const snapshot = reduceActivity(start, 'claude', { type: 'system', subtype: 'background_tasks_changed', tasks: [] }, new Map())!
    expect(snapshot.subagents).toEqual([{ id: 'front' }])
    expect(snapshot.jobs).toEqual([])
  })

  it('leaves unexposed capabilities unavailable and rejects malformed observed plans', () => {
    expect(reduceActivity(empty, 'codex', { method: 'item/started', params: { item: { type: 'commandExecution', processId: '123' } } }, new Map())).toBeUndefined()
    expect(() => reduceActivity(empty, 'codex', { method: 'turn/plan/updated', params: { plan: [{ step: 'Bad', status: 'guessed' }] } }, new Map())).toThrow('Native plan step is invalid')
  })
})

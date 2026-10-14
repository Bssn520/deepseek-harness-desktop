import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { NativeActivityState } from '../../shared/activity'
import type { HostContext } from '../types'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { getServerContext } from 'dsh-h3/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as zodModule from 'zod'
import { resetRuntime, runtime } from '../config/runtime'
import { activity } from './activity'

vi.mock('dsh-h3/utils', () => ({ getServerContext: vi.fn() }))
vi.mock('../server', () => ({ server: vi.fn() }))

const STATE: NativeActivityState = {
  plan: { steps: [{ content: 'Native step', status: 'in_progress' }] },
  subagents: [{ id: 'native-child', status: 'waiting_remote' }],
  jobs: [],
  unavailable: { plan: null, subagents: 'partial', jobs: 'not-exposed' },
}
let context: Context
let projections: SessionProjectionRegistry

function event(value: NativeActivityState): SessionEvent {
  return { type: 'plugin:dsh-tauri-kernel/activity', ignorable: true, seq: SessionSeq(0), time: 1000, data: value } as unknown as SessionEvent
}

beforeEach(async () => {
  await resetRuntime()
  runtime.lifetime = new AbortController()
  context = new Context()
  projections = new SessionProjectionRegistry(context)
  context.provide('loader', { import: async () => zodModule, unwrapExports: (value: unknown) => value } as unknown as HostContext['loader'])
  vi.mocked(getServerContext).mockReturnValue(context)
})
afterEach(async () => {
  await context.fiber.dispose()
  await resetRuntime()
  vi.restoreAllMocks()
})

describe('native activity durable projection', () => {
  it('restores full observed state through real checkpoint replay without adding model history', async () => {
    await activity.register()
    const session = Session.create(SessionId('session-a'), [event(STATE)])
    expect(projections.snapshot(session).values.bridgeActivity).toEqual(STATE)
    const checkpoint = JSON.parse(JSON.stringify(projections.checkpoint(session)))
    const restored = projections.restore(checkpoint, [event(STATE)], SessionLogOffset(0), session.header, SessionLogOffset(0))
    expect(restored.snapshot.values.bridgeActivity).toEqual(STATE)
    expect(projections.viewCheckpoint(restored.checkpoint).bridgeActivity).toEqual(STATE)
    expect(event(STATE).surfaceOp).toBeUndefined()
  })

  it('does not project a fork-inherited native activity record into the child session', async () => {
    await activity.register()
    const session = Session.create(SessionId('child'))
    const restored = projections.restore({}, [event(STATE)], SessionLogOffset(0), { ...session.header, parentSession: SessionId('parent'), isSeeded: true }, SessionLogOffset(1))
    expect(restored.snapshot.values.bridgeActivity).toEqual({ plan: null, subagents: [], jobs: [], unavailable: { plan: 'not-exposed', subagents: 'not-exposed', jobs: 'not-exposed' } })
  })

  it('keeps native execution alive when durable activity publication fails', async () => {
    await activity.register()
    const session = Session.create(SessionId('session-a'))
    const agent = { id: session.id, session } as Agent
    const controller = new AbortController()
    runtime.controllers.set(agent.id, controller)
    context.provide('agents', { get: () => agent } as unknown as HostContext['agents'])
    context.provide('sessions', { get: () => session } as unknown as HostContext['sessions'])
    runtime.appendActivity = vi.fn(() => {
      throw new Error('STORAGE_UNAVAILABLE')
    })
    const warning = vi.spyOn(context.logger, 'warn').mockImplementation(() => {})
    expect(() => activity.update(agent, controller, 'codex', { method: 'turn/plan/updated', params: { plan: [{ step: 'Native step', status: 'inProgress' }] } })).not.toThrow()
    expect(runtime.appendActivity).toHaveBeenCalledTimes(2)
    expect(controller.signal.aborted).toBe(false)
    expect(projections.snapshot(session).values.bridgeActivity?.unavailable.plan).toBe('not-exposed')
    expect(warning).toHaveBeenCalledTimes(2)
  })

  it('clears projection capability on unload instead of retaining stale observed state', async () => {
    const dispose = await activity.register()
    const session = Session.create(SessionId('session-a'), [event(STATE)])
    expect(projections.snapshot(session).values.bridgeActivity).toEqual(STATE)
    dispose()
    expect(projections.snapshot(session).values).toEqual({})
    expect(runtime.activitySchema).toBeUndefined()
  })
})

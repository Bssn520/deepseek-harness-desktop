import type { Agent } from '@deepseek-ai/dsh-agent'
import type { NativeActivityState } from '../../shared/activity'
import type { KernelBinding } from '../../shared/types'
import type { HostContext } from '../types'
import { getServerContext } from 'dsh-h3/utils'
import { defineService } from 'dsh-tauri'
import { runtime } from '../config/runtime'
import { server } from '../server'
import { loadRuntimeZod } from '../utils/runtime-modules'
import { reduceActivity } from './activity.utils'

const RECORD_TYPE = 'plugin:dsh-tauri-kernel/activity'
const EMPTY: NativeActivityState = { plan: null, subagents: [], jobs: [], unavailable: { plan: 'not-exposed', subagents: 'not-exposed', jobs: 'not-exposed' } }

export const activity = defineService({
  async register(): Promise<() => void> {
    const ctx = getServerContext<HostContext>(server)
    try {
      const lifetime = runtime.lifetime
      const z = await loadRuntimeZod(ctx.loader)
      lifetime.signal.throwIfAborted()
      if (runtime.lifetime !== lifetime || getServerContext<HostContext>(server) !== ctx)
        return () => {}
      const item = z.object({ id: z.string().min(1).max(1024), label: z.string().max(16384).optional(), status: z.string().max(256).optional(), details: z.string().max(65536).optional(), parentId: z.string().max(1024).optional() }).strict()
      const reason = z.string().nullable()
      const schema = z.object({
        plan: z.object({ steps: z.array(z.object({ content: z.string().max(16384), status: z.enum(['pending', 'in_progress', 'completed']) }).strict()).max(1024), explanation: z.string().max(65536).optional() }).strict().nullable(),
        subagents: z.array(item).max(1024),
        jobs: z.array(item).max(1024),
        unavailable: z.object({ plan: reason, subagents: reason, jobs: reason }).strict(),
      }).strict()
      const stateSchema = z.object({ inheritedEventCount: z.number().int().nonnegative(), activity: schema }).strict()
      const dispose = ctx.sessionProjections.register({
        key: 'bridgeActivity',
        stateSchema,
        init: (_header, inheritedEventCount) => ({ inheritedEventCount, activity: EMPTY }),
        apply(state, event) {
          const type: string = event.type
          return event.seq >= state.inheritedEventCount && type === RECORD_TYPE && event.ignorable === true ? { ...state, activity: schema.parse(event.data) } : state
        },
        wire: { viewSchema: schema, view: state => state.activity },
        stateVersion: 1,
      })
      runtime.activitySchema = schema
      runtime.appendActivity = undefined
      return () => {
        dispose()
        if (runtime.activitySchema === schema) {
          runtime.activitySchema = undefined
          runtime.appendActivity = undefined
        }
      }
    }
    catch (error) {
      ctx.logger.warn('dsh-tauri-kernel: native activity projection unavailable', error)
      return () => {}
    }
  },

  update(agent: Agent, controller: AbortController, backend: KernelBinding['backend'], message: Record<string, unknown>): void {
    if (controller.signal.aborted || runtime.lifetime.signal.aborted || runtime.controllers.get(agent.id) !== controller)
      return
    const ctx = getServerContext<HostContext>(server)
    try {
      if (!runtime.activitySchema || !runtime.appendActivity || ctx.agents.get(agent.id) !== agent || ctx.sessions.get(agent.id) !== agent.session)
        return
      const state = ctx.sessionProjections.stateOf(agent.session, 'bridgeActivity')
      if (!state)
        return
      let pending = runtime.activityPlans.get(agent)
      if (!pending) {
        pending = new Map()
        runtime.activityPlans.set(agent, pending)
      }
      const next = reduceActivity(state.activity, backend, message, pending)
      if (next && JSON.stringify(next) !== JSON.stringify(state.activity))
        runtime.appendActivity(agent.session, RECORD_TYPE, runtime.activitySchema.parse(next))
    }
    catch (error) {
      ctx.logger.warn('dsh-tauri-kernel: native activity mapping failed; execution unchanged', error)
      try {
        const state = ctx.sessionProjections.stateOf(agent.session, 'bridgeActivity')?.activity
        if (state && runtime.appendActivity && !controller.signal.aborted && runtime.controllers.get(agent.id) === controller && ctx.agents.get(agent.id) === agent && ctx.sessions.get(agent.id) === agent.session) {
          const capability = message.method === 'turn/plan/updated' || message.type === 'assistant' || message.type === 'user' ? 'plan' : backend === 'codex' ? 'subagents' : 'jobs'
          runtime.appendActivity(agent.session, RECORD_TYPE, { ...state, unavailable: { ...state.unavailable, [capability]: 'mapping-failed' } })
        }
      }
      catch (failure) {
        ctx.logger.warn('dsh-tauri-kernel: native activity error could not be recorded', failure)
      }
    }
  },
})

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap { bridgeActivity: { inheritedEventCount: number, activity: NativeActivityState } }
}

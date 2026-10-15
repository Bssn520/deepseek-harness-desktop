import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ClientContext } from 'dsh-tauri/client'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nativeActivity } from './native-activity'

vi.mock('dsh-tauri/client', async () => await import('../../../../dsh-tauri/src/client/register/index'))
vi.mock('../components/native-activity', () => ({ NativeActivity: () => null }))
afterEach(() => vi.restoreAllMocks())

describe('native activity registration', () => {
  it('adds to the existing session dock without replacing official entries and removes on unload', () => {
    const core = new SlotCore()
    core.register({ name: 'root', children: { 'conversation.input.dock': { kind: 'list', scope: 'session' } } }, (props: { renderSlot: unknown }) => {
      void props.renderSlot
      return null
    })
    core.register({ name: 'conversation.input.dock', id: 'official-todo' }, () => null)
    const slots = { spec: core.spec.bind(core), register: core.register.bind(core), inject: (_key: string, setup: () => () => void) => setup() }
    const dispose = nativeActivity.call({ get: (name: string) => name === 'slots' ? slots : undefined } as unknown as ClientContext)
    expect(core.entries('conversation.input.dock').map(entry => entry.options.id)).toEqual(['official-todo', 'dsh-tauri-kernel:activity'])
    dispose()
    expect(core.entries('conversation.input.dock').map(entry => entry.options.id)).toEqual(['official-todo'])
  })

  it('warns explicitly when the official dock registration capability is absent', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const dispose = nativeActivity.call({ get: () => undefined } as unknown as ClientContext)
    expect(warning).toHaveBeenCalledExactlyOnceWith('[dsh-tauri-kernel] native activity unavailable; official dock registration APIs are missing')
    dispose()
  })
})

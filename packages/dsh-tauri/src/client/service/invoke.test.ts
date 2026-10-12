// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { invoke, TYPE_INVOKE_REPLY } from './invoke'

const bridge = vi.hoisted(() => ({ send: vi.fn(), listen: vi.fn(), unlisten: vi.fn() }))
vi.mock('./invoke-parent', () => ({ invokeParent: bridge.send }))
vi.mock('./listen-parent', () => ({ listenParent: bridge.listen }))

beforeEach(() => {
  vi.useFakeTimers()
  bridge.send.mockReturnValue({ ok: true })
  bridge.listen.mockReturnValue(bridge.unlisten)
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.resetAllMocks()
})

it('keeps the ordinary invoke timeout at fifteen seconds', async () => {
  const result = invoke('list_pets')
  const rejection = expect(result).rejects.toThrow('invoke list_pets timed out')
  await vi.advanceTimersByTimeAsync(15_000)
  await rejection
  expect(bridge.unlisten).toHaveBeenCalledExactlyOnceWith()
})

it('allows a repository import to finish after the ordinary timeout and cleans up its timer', async () => {
  const result = invoke('import_pet_repository', { repository: 'hairyf/dsh-chan-sticker-pet' }, { timeoutMs: 360_000 })
  const completion = expect(result).resolves.toEqual({ id: 'chat:sticker' })
  await vi.advanceTimersByTimeAsync(16_000)
  expect(bridge.unlisten).not.toHaveBeenCalled()
  const request = bridge.send.mock.calls[0]![0]
  bridge.listen.mock.calls[0]![0]({ type: TYPE_INVOKE_REPLY, nonce: request.nonce, ok: true, value: { id: 'chat:sticker' } })
  await completion
  expect(bridge.unlisten).toHaveBeenCalledExactlyOnceWith()
  expect(vi.getTimerCount()).toBe(0)
})

it('rejects a repository import at its requested timeout', async () => {
  const result = invoke('import_pet_repository', {}, { timeoutMs: 360_000 })
  const rejection = expect(result).rejects.toThrow('invoke import_pet_repository timed out')
  await vi.advanceTimersByTimeAsync(359_999)
  expect(bridge.unlisten).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  await rejection
  expect(bridge.unlisten).toHaveBeenCalledExactlyOnceWith()
})

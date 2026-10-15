// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SettingsSidebar } from './settings-sidebar'

const observer = vi.hoisted(() => ({ resize: () => {} }))
vi.mock('dsh-tauri/client', () => ({
  clamp: (value: number, min: number, max: number) => Math.min(Math.max(value, min), max),
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  isEmpty: (values: unknown[]) => values.length === 0,
  useEventListener: () => {},
  useStore: (value: unknown) => value,
  useResizeObserver: (_ref: unknown, callback: () => void) => { observer.resize = callback },
}))
vi.mock('../locales', () => ({ locale: { text: (key: string) => key, useLocale: () => 'en' } }))
vi.mock('../store', () => ({ store: {
  settings: { open: true, query: '', activeId: 'general' },
  sections: { rows: [{ id: 'general', label: 'General' }] },
} }))
vi.mock('../components/official', () => ({ Input: 'input' }))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ useModalLayer: undefined }))
vi.mock('@deepseek-ai/dsh-client-ui-renderer', () => ({ SlotOutlet: () => <section>Settings</section> }))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

it('uses the conversation content width on open and resize, excluding settings padding', () => {
  const dock = document.createElement('div')
  dock.dataset.slot = 'conversation.input.dock'
  dock.style.setProperty('--dsh-chat-content-width', '860px')
  document.body.append(dock)
  const view = render(<SettingsSidebar useSessions={selector => selector({} as never)} />)
  const content = view.container.querySelector<HTMLElement>('[data-slot="settings.content"]')!
  observer.resize()
  expect(content.style.getPropertyValue('--dsh-chat-content-width')).toBe('860px')
  const column = content.firstElementChild as HTMLElement
  expect(column.style.maxWidth).toBe('calc(var(--dsh-chat-content-width, 748px) + 72px)')
  expect(column.classList.contains('w-full')).toBe(true)
  expect(column.classList.contains('px-[36px]')).toBe(true)
  dock.style.setProperty('--dsh-chat-content-width', '700px')
  observer.resize()
  expect(content.style.getPropertyValue('--dsh-chat-content-width')).toBe('700px')
  dock.remove()
  observer.resize()
  expect(content.style.getPropertyValue('--dsh-chat-content-width')).toBe('')
})

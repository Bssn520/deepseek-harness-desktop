// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { store } from '@/store'
import { Iframe } from './iframe'

vi.mock('@choochmeque/tauri-plugin-notifications-api', () => ({}))
vi.mock('@overlastic/react', () => ({ useOverlay: () => vi.fn() }))
vi.mock('@/ui/dialog/config', () => ({ ConfigDialog: () => null }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/hooks/use-dsh-style', () => ({ useDshStyle: () => [{}, vi.fn()] }))
vi.mock('@/hooks/use-invoke-iframe', () => ({ useInvokeIframe: vi.fn() }))
vi.mock('@/hooks/use-notification-action', () => ({ useNotificationAction: vi.fn() }))
vi.mock('@/hooks/use-notification-clicked', () => ({ useNotificationClicked: vi.fn() }))
vi.mock('@/hooks/use-sync-visibility', () => ({ useSyncVisibility: vi.fn() }))
vi.mock('@/hooks/use-zoom-factor', () => ({ useZoomFactor: vi.fn() }))

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  Object.assign(store.harness, {
    status: 'ready',
    serviceHealthy: false,
    serviceRunning: true,
    busyAction: 'restart',
    iframeKey: 1077,
    iframeAliveKey: null,
    iframeLoaded: false,
    iframeError: false,
    iframeSrc: 'http://127.0.0.1:3081/?token=secret',
  })
})

afterEach(async () => {
  cleanup()
  store.harness.serviceHealthy = false
  await vi.advanceTimersByTimeAsync(0)
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('logs local mount and document states once per transition without adding waiting UI', async () => {
  const iframeRef = createRef<HTMLIFrameElement>()
  const view = render(<Iframe iframeRef={iframeRef} />)
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.queryByTestId('dsh-shell-iframe')).toBeNull()
  expect(console.warn).toHaveBeenCalledWith('[Iframe] view', expect.objectContaining({
    branch: 'service-wait',
    serviceHealthy: false,
    serviceRunning: true,
    iframeKey: 1077,
    mounted: false,
  }))
  view.rerender(<Iframe iframeRef={iframeRef} />)
  expect(vi.mocked(console.warn).mock.calls.filter(([tag]) => tag === '[Iframe] view')).toHaveLength(1)

  await act(async () => {
    store.harness.serviceHealthy = true
  })
  const frame = screen.getByTestId<HTMLIFrameElement>('dsh-shell-iframe')
  expect(frame.style.visibility).toBe('visible')
  expect(screen.queryByRole('status')).toBeNull()
  expect(console.warn).toHaveBeenCalledWith('[Iframe] view', expect.objectContaining({ branch: 'document-wait', mounted: true, iframeAlive: false }))
  await act(async () => {
    frame.dispatchEvent(new Event('load'))
  })
  expect(console.warn).toHaveBeenCalledWith('[Iframe] view', expect.objectContaining({ branch: 'document-wait', iframeLoaded: true }))
  await act(async () => {
    store.harness.markIframeAlive()
  })
  expect(screen.getByTestId('dsh-shell-iframe')).toBe(frame)
  expect(console.warn).toHaveBeenCalledWith('[Iframe] view', expect.objectContaining({ branch: 'local-frame', iframeAlive: true }))
  await act(async () => {
    store.harness.markIframeError()
  })
  expect(screen.getByText('ui.iframe_error')).not.toBeNull()
  expect(frame.style.visibility).toBe('hidden')
  expect(console.warn).toHaveBeenCalledWith('[Iframe] view', expect.objectContaining({ branch: 'iframe-error', iframeError: true }))
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('secret')
})

it('diagnoses remote frame visibility across local health and error transitions without changing it', async () => {
  render(<Iframe iframeRef={createRef()} srcOverride="https://example.test/?token=secret" />)
  expect(screen.getByTestId('dsh-shell-iframe').getAttribute('src')).toBe('https://example.test/?token=secret')
  expect(screen.queryByRole('status')).toBeNull()
  expect(console.warn).toHaveBeenCalledWith('[Iframe] view', expect.objectContaining({ branch: 'remote-loading', remoteMode: true, serviceHealthy: false, mounted: true, iframeHidden: true }))
  const frame = screen.getByTestId<HTMLIFrameElement>('dsh-shell-iframe')
  await act(async () => {
    frame.dispatchEvent(new Event('load'))
  })
  expect(frame.style.visibility).toBe('visible')
  expect(console.warn).toHaveBeenCalledWith('[Iframe] view', expect.objectContaining({ branch: 'remote-frame', iframeHidden: false }))
  await act(async () => {
    store.harness.serviceHealthy = true
    store.harness.markIframeError()
  })
  expect(frame.style.visibility).toBe('hidden')
  expect(screen.queryByText('ui.iframe_error')).toBeNull()
  expect(console.warn).toHaveBeenLastCalledWith('[Iframe] view', expect.objectContaining({
    branch: 'remote-frame',
    serviceHealthy: true,
    iframeError: true,
    iframeHidden: true,
  }))
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('secret')
})

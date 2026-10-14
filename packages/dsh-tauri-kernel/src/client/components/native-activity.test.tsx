// @vitest-environment jsdom
import type { NativeActivityState } from '../../shared/activity'
import type { KernelBinding } from '../../shared/types'
import type { NativeActivityProps } from './native-activity'
import { cleanup, render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeActivity } from './native-activity'

vi.mock('../locales', () => ({ locale: { useLocale: () => {}, text: (key: string) => key } }))
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const BINDING: KernelBinding = { sessionId: 'session-a', nativeSessionId: 'native-a', backend: 'codex' }
const ACTIVITY: NativeActivityState = {
  plan: { steps: [{ content: 'Inspect contracts', status: 'completed' }], explanation: 'Native explanation' },
  subagents: [{ id: 'native-child', label: '<script>not markup</script>', status: 'waiting_remote', details: 'Native details', parentId: 'native-a' }],
  jobs: [{ id: 'native-job' }],
  unavailable: { plan: null, subagents: null, jobs: 'not-exposed' },
}

function props(binding: KernelBinding | null | undefined, activity?: NativeActivityState): NativeActivityProps {
  return { sessionId: 'session-a', useProjection(key: string) {
    useRef(null)
    return key === 'bridgeKernel' ? binding : activity
  } } as unknown as NativeActivityProps
}

describe('native activity dock', () => {
  it('renders native statuses verbatim with unknown fallback and no execution controls', () => {
    const view = render(<NativeActivity {...props(BINDING, ACTIVITY)} />)
    expect(view.getByText('Inspect contracts — activity.completed')).toBeTruthy()
    expect(view.getByText('<script>not markup</script> — waiting_remote')).toBeTruthy()
    expect(view.getByText('native-job — activity.unknown')).toBeTruthy()
    expect(view.getByText('Native explanation')).toBeTruthy()
    expect(view.getByText('Native details')).toBeTruthy()
    expect(view.container.querySelector('script')).toBeNull()
    expect(view.queryAllByRole('button')).toHaveLength(0)
    expect(view.queryAllByRole('link')).toHaveLength(0)
    expect(view.getAllByRole('status').map(node => node.textContent)).toEqual(['activity.unavailable'])
  })

  it('updates native status from new projection values while preserving partial-list notices', () => {
    const view = render(<NativeActivity {...props(BINDING, ACTIVITY)} />)
    view.rerender(<NativeActivity {...props(BINDING, { ...ACTIVITY, subagents: [{ id: 'native-child', status: 'completed' }], unavailable: { ...ACTIVITY.unavailable, subagents: 'partial' } })} />)
    expect(view.getByText('native-child — completed')).toBeTruthy()
    expect(view.queryByText('<script>not markup</script> — waiting_remote')).toBeNull()
    expect(view.getAllByRole('status').map(node => node.textContent)).toEqual(['activity.partial', 'activity.unavailable'])
  })

  it('does not leak prior native state into official, unknown or forked sessions', () => {
    const view = render(<NativeActivity {...props(BINDING, ACTIVITY)} />)
    for (const binding of [null, undefined, { ...BINDING, sessionId: 'parent-session' }]) {
      view.rerender(<NativeActivity {...props(binding, ACTIVITY)} />)
      expect(view.container.innerHTML).toBe('')
    }
  })

  it('distinguishes missing capability, parse failure and observed empty lists', () => {
    const view = render(<NativeActivity {...props(BINDING)} />)
    expect(view.getByRole('status').textContent).toBe('activity.unavailable')
    view.rerender(<NativeActivity {...props(BINDING, { plan: null, subagents: [], jobs: [], unavailable: { plan: 'mapping-failed', subagents: null, jobs: null } })} />)
    expect(view.getAllByRole('status').map(node => node.textContent)).toEqual(['activity.mappingFailed'])
    expect(view.getAllByText('activity.empty')).toHaveLength(3)
  })
})

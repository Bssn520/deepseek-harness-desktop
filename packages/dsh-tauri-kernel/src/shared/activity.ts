export interface NativeActivityItem {
  id: string
  label?: string
  status?: string
  details?: string
  parentId?: string
}

export interface NativeActivityState {
  plan: { steps: { content: string, status: 'pending' | 'in_progress' | 'completed' }[], explanation?: string } | null
  subagents: NativeActivityItem[]
  jobs: NativeActivityItem[]
  unavailable: { plan: string | null, subagents: string | null, jobs: string | null }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    bridgeActivity: NativeActivityState
  }
}

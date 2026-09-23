/** Collector link/upload status surfaced to the renderer settings pane. */
export type WebuddyCollectorStatus = {
  linked: boolean
  userId: string | null
  lastPush: {
    at: string
    pushed: number
    failed: number
    authRejected: boolean
    error?: string
  } | null
  pending: number
}

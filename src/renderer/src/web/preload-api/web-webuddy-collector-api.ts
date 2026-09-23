import type { PreloadApi } from '../../../../preload/api-types'

/** Browser fallback: the collector never runs outside the desktop app. */
export function createWebWebuddyCollectorApi(): Partial<PreloadApi> {
  return {
    webuddyCollector: {
      status: () => Promise.resolve({ linked: false, userId: null, lastPush: null, pending: 0 })
    }
  }
}

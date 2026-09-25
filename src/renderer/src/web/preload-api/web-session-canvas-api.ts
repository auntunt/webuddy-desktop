import type { PreloadApi } from '../../../../preload/api-types'

const DESKTOP_ONLY = { ok: false as const, reason: '会话画布的操作只在桌面应用中可用。' }

/** Browser fallback: canvas actions/data read local terminals and files, so the web client refuses them. */
export function createWebSessionCanvasApi(): Partial<PreloadApi> {
  return {
    sessionCanvas: {
      sendPrompt: () => Promise.resolve(DESKTOP_ONLY),
      supervise: () => Promise.resolve(DESKTOP_ONLY),
      listExternalSessions: () => Promise.resolve(DESKTOP_ONLY),
      listMessages: () => Promise.resolve(DESKTOP_ONLY),
      recordPassAlong: () => Promise.resolve(DESKTOP_ONLY)
    }
  }
}

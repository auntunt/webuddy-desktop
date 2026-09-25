import { toast } from 'sonner'
import type { SessionCanvasSendPromptArgs } from '../../../../shared/session-canvas-actions'

/** Send to a session's terminal; failures surface as a toast, never a throw. */
export async function sendToSession(args: SessionCanvasSendPromptArgs): Promise<boolean> {
  try {
    const result = await window.api.sessionCanvas.sendPrompt(args)
    if (!result.ok) {
      toast.error(result.reason)
    }
    return result.ok
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
    return false
  }
}

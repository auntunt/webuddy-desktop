import { isDashboardPopoutRenderer } from './dashboard-popout-window'
import { sessionCanvasPopout } from './session-canvas-popout-window'

/** Either first-party pop-out window (dashboard or session canvas): text clipboard and
 *  Edit-menu selection actions only, never the main window's wider authority. */
export function isFirstPartyPopoutRenderer(sender: object): boolean {
  return isDashboardPopoutRenderer(sender) || sessionCanvasPopout.isRenderer(sender)
}

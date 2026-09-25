import type { BrowserWindow } from 'electron'
import { stepUIZoomLevel, type UIZoomDirection } from '../../shared/ui-zoom-level'
import { nativeZoomCommandMatchesKeybindings } from '../../shared/window-shortcut-policy'
import {
  keybindingMatchesAction,
  type KeybindingActionId,
  type KeybindingInput,
  type KeybindingOverrides
} from '../../shared/keybindings'

const ZOOM_SHORTCUTS: readonly [KeybindingActionId, UIZoomDirection][] = [
  ['zoom.in', 'in'],
  ['zoom.out', 'out'],
  ['zoom.reset', 'reset']
]

function resolveZoomShortcut(
  input: KeybindingInput,
  keybindings: KeybindingOverrides | undefined
): UIZoomDirection | null {
  // Why: this runs on every keydown; avoid scanning unrelated window shortcuts in the typing path.
  for (const [actionId, direction] of ZOOM_SHORTCUTS) {
    if (
      keybindingMatchesAction(actionId, input, process.platform, keybindings, { context: 'app' })
    ) {
      return direction
    }
  }
  return null
}

export function zoomPopoutWindow(window: BrowserWindow, direction: UIZoomDirection): void {
  const webContents = window.webContents
  webContents.setZoomLevel(stepUIZoomLevel(webContents.getZoomLevel(), direction))
}

/** Window-local zoom chords for a pop-out on its own session (zoom is shared per origin). */
export function installPopoutWindowLocalZoom(
  window: BrowserWindow,
  getKeybindings: (() => KeybindingOverrides | undefined) | undefined
): void {
  // Why: the pop-out has no renderer-side shortcut plumbing; resolve only the
  // zoom chords here and let every other key fall through untouched.
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') {
      return
    }
    const direction = resolveZoomShortcut(input, getKeybindings?.())
    if (direction) {
      event.preventDefault()
      zoomPopoutWindow(window, direction)
    }
  })
  window.webContents.on('zoom-changed', (event, direction) => {
    // Why: Electron reports Ctrl/Cmd+wheel zoom outside the keyboard input path.
    if (
      (direction === 'in' || direction === 'out') &&
      nativeZoomCommandMatchesKeybindings(direction, process.platform, getKeybindings?.(), {
        context: 'app'
      })
    ) {
      event.preventDefault()
      zoomPopoutWindow(window, direction)
    }
  })
}

import type { BrowserWindow } from 'electron'
import type { Store } from '../persistence'
import type { UIZoomDirection } from '../../shared/ui-zoom-level'
import type { KeybindingOverrides } from '../../shared/keybindings'
import { createPopoutWindowController } from './popout-window-controller'

// Why: singleton — the dashboard is a companion surface, so a second "Pop Out"
// request focuses the existing window rather than spawning duplicates.
const dashboardPopout = createPopoutWindowController({
  logTag: 'dashboard-popout',
  title: 'Webuddy Agent Dashboard',
  openChangedChannel: 'dashboard:popoutOpenChanged',
  boundsKey: 'dashboardPopoutBounds',
  partition: 'orca-dashboard-popout'
})

/** The live pop-out window, or null when closed. Used by the dashboard relay to
 *  forward snapshots to the popout's webContents. */
export function getDashboardPopoutWindow(): BrowserWindow | null {
  return dashboardPopout.getWindow()
}

export function isDashboardPopoutRenderer(sender: object): boolean {
  return dashboardPopout.isRenderer(sender)
}

/**
 * Apply a zoom step to the pop-out when it is the focused window. Returns false
 * when the pop-out is closed or unfocused so the caller can route the action to
 * the main window instead — the menu's zoom items must act on the window the
 * user is looking at.
 */
export function zoomDashboardPopoutIfFocused(direction: UIZoomDirection): boolean {
  return dashboardPopout.zoomIfFocused(direction)
}

/** Subscribe to pop-out open/close transitions in the main process. */
export function onDashboardPopoutOpenChanged(listener: (open: boolean) => void): () => void {
  return dashboardPopout.onOpenChanged(listener)
}

/** Open the pop-out dashboard window, or focus it if already open. */
export function createOrFocusDashboardPopout(
  store: Store | null,
  options: { getKeybindings?: () => KeybindingOverrides | undefined } = {}
): BrowserWindow {
  return dashboardPopout.createOrFocus(store, options)
}

/** Close the pop-out dashboard if it is open. Called when the main window
 *  closes so the dashboard never orphans without its owning app window. */
export function closeDashboardPopout(): void {
  dashboardPopout.close()
}

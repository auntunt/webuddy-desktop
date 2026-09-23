import { ipcMain } from 'electron'
import type { WebuddyCollectorStatus } from '../../shared/webuddy-collector'
import { readCollectorStatus } from '../webuddy/collector-status'

/** Registers the read-only IPC channel the settings pane reads for collector link/upload status. */
export function registerWebuddyCollectorHandlers(): void {
  ipcMain.removeHandler('webuddy:collectorStatus')
  ipcMain.handle('webuddy:collectorStatus', (): Promise<WebuddyCollectorStatus> =>
    readCollectorStatus()
  )
}

import { ipcRenderer } from 'electron'
import type { WebuddyCollectorStatus } from '../../shared/webuddy-collector'
import type { PreloadApi } from '../api-types'

export const webuddyCollectorApi = {
  status: (): Promise<WebuddyCollectorStatus> => ipcRenderer.invoke('webuddy:collectorStatus')
} satisfies PreloadApi['webuddyCollector']

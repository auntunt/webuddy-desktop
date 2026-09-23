import type { WebuddyCollectorStatus } from '../../shared/webuddy-collector'

export type WebuddyCollectorApi = {
  status: () => Promise<WebuddyCollectorStatus>
}

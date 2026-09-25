import { translate } from '@/i18n/i18n'
import { SESSION_CANVAS_EXTERNAL_STATE } from './session-graph-membership-model'

/** Filterable states, in toolbar order: live `AgentStatusState`s then read-only external cards. */
export const SESSION_CANVAS_FILTER_STATES = [
  'working',
  'waiting',
  'blocked',
  'done',
  SESSION_CANVAS_EXTERNAL_STATE
] as const

export function sessionCanvasStateLabel(state: string): string {
  switch (state) {
    case 'working':
      return translate('sessionCanvas.state.working', '工作中')
    case 'waiting':
      return translate('sessionCanvas.state.waiting', '等你决定')
    case 'blocked':
      return translate('sessionCanvas.state.blocked', '受阻')
    case 'done':
      return translate('sessionCanvas.state.done', '已完成')
    case SESSION_CANVAS_EXTERNAL_STATE:
      return translate('sessionCanvas.state.external', '外部会话')
    default:
      return state
  }
}

export function sessionCanvasOtherGroupLabel(): string {
  return translate('sessionCanvas.group.other', '其他')
}

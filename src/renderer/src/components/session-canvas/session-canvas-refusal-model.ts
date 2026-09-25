import { translate } from '@/i18n/i18n'

// Why thunks: translate must run at toast time (language can change) with literal keys
// so localization extraction can see them.
const REFUSAL_LABELS: Record<string, () => string> = {
  agent_prompt_blocked: () =>
    translate(
      'sessionCanvas.refusal.agentPromptBlocked',
      '会话正在等你审批权限，先处理审批再发送。'
    ),
  permission: () =>
    translate(
      'sessionCanvas.refusal.agentPromptBlocked',
      '会话正在等你审批权限，先处理审批再发送。'
    ),
  agent_prompt_stalled: () =>
    translate('sessionCanvas.refusal.agentPromptStalled', '会话没有接收这条消息，请稍后再试。'),
  'no-agent': () => translate('sessionCanvas.refusal.noAgent', '这个终端里没有在运行的智能体。'),
  terminal_not_writable: () =>
    translate(
      'sessionCanvas.refusal.terminalNotWritable',
      '终端当前不接受输入，可能已退出或被锁定。'
    ),
  terminal_handle_stale: () =>
    translate('sessionCanvas.refusal.terminalHandleStale', '终端已经换了一个会话，请刷新后重试。'),
  terminal_exited: () => translate('sessionCanvas.refusal.terminalExited', '终端已经退出。'),
  terminal_gone: () => translate('sessionCanvas.refusal.terminalGone', '终端已经不存在。'),
  terminal_not_found: () => translate('sessionCanvas.refusal.terminalNotFound', '找不到这个终端。'),
  terminal_tab_not_found: () =>
    translate('sessionCanvas.refusal.terminalTabNotFound', '找不到这个终端标签。'),
  terminal_tab_pinned: () =>
    translate('sessionCanvas.refusal.terminalTabPinned', '标签已固定，不能从画布关闭。'),
  terminal_tab_close_timeout: () =>
    translate('sessionCanvas.refusal.terminalTabCloseTimeout', '关闭终端超时，请稍后再试。'),
  runtime_unavailable: () =>
    translate('sessionCanvas.refusal.runtimeUnavailable', '运行时暂时不可用。'),
  timeout: () => translate('sessionCanvas.refusal.timeout', '操作超时，请稍后再试。'),
  run_not_found: () => translate('sessionCanvas.refusal.runNotFound', '找不到协调者的编排运行。'),
  task_not_startable: () =>
    translate('sessionCanvas.refusal.taskNotStartable', '任务当前无法启动。'),
  dispatch_inactive: () => translate('sessionCanvas.refusal.dispatchInactive', '这次派发已失效。'),
  worker_identity_changed: () =>
    translate('sessionCanvas.refusal.workerIdentityChanged', '工人会话已经变化，请重新连线。')
}

/** Readable Chinese for refusal codes returned by terminal.send / workerStart / terminal.close. */
export function describeSessionCanvasRefusal(reason: string): string {
  return REFUSAL_LABELS[reason.trim()]?.() ?? reason
}

import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { RpcResponse } from '../runtime/rpc/core'
import { RpcDispatcher } from '../runtime/rpc/dispatcher'
import { ALL_RPC_METHODS } from '../runtime/rpc/methods'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../shared/protocol-version'
import type {
  SessionCanvasSendPromptArgs,
  SessionCanvasSendPromptResult,
  SessionCanvasSuperviseArgs,
  SessionCanvasSuperviseResult
} from '../../shared/session-canvas-actions'

export type SessionCanvasActionDeps = {
  resolveTerminalHandle: (paneKey: string) => string | null
  hasCurrentRun: (paneKey: string) => boolean
  callRuntime: (method: string, params: unknown) => Promise<RpcResponse>
}

const RUN_OBJECTIVE_MAX_CHARS = 200

function unknownPane(paneKey: string): { ok: false; reason: string } {
  return { ok: false, reason: `找不到会话 ${paneKey} 的终端，它可能已关闭。` }
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? { ...value } : {}
}

export function createSessionCanvasActions(deps: SessionCanvasActionDeps): {
  sendPrompt: (args: SessionCanvasSendPromptArgs) => Promise<SessionCanvasSendPromptResult>
  supervise: (args: SessionCanvasSuperviseArgs) => Promise<SessionCanvasSuperviseResult>
} {
  return {
    async sendPrompt({ paneKey, text }) {
      if (!text.trim()) {
        return { ok: false, reason: '消息不能为空。' }
      }
      const terminal = deps.resolveTerminalHandle(paneKey)
      if (!terminal) {
        return unknownPane(paneKey)
      }
      // Why: terminal.send owns the settled-prompt vs plain-send choice and the lock/lease guards.
      const response = await deps.callRuntime('terminal.send', {
        terminal,
        text,
        enter: true,
        agentPrompt: true,
        client: { id: 'session-canvas', type: 'desktop' }
      })
      if (!response.ok) {
        return { ok: false, reason: response.error.message }
      }
      const send = readRecord(readRecord(response.result).send)
      if (send.accepted === true) {
        return { ok: true }
      }
      const reason =
        typeof send.refusedReason === 'string'
          ? send.refusedReason
          : send.agentSessionRefusal
            ? '该会话由结构化会话持有，当前不接受终端输入。'
            : '终端当前不接受输入。'
      return { ok: false, reason }
    },

    async supervise({ coordinatorPaneKey, workerPaneKey, task }) {
      const spec = task.trim()
      if (!spec) {
        return { ok: false, reason: '任务说明不能为空。' }
      }
      const from = deps.resolveTerminalHandle(coordinatorPaneKey)
      if (!from) {
        return unknownPane(coordinatorPaneKey)
      }
      const terminal = deps.resolveTerminalHandle(workerPaneKey)
      if (!terminal) {
        return unknownPane(workerPaneKey)
      }
      if (!deps.hasCurrentRun(coordinatorPaneKey)) {
        const created = await deps.callRuntime('orchestration.runCreate', {
          from,
          objective: spec.slice(0, RUN_OBJECTIVE_MAX_CHARS)
        })
        if (!created.ok) {
          return { ok: false, reason: created.error.message }
        }
      }
      const response = await deps.callRuntime('orchestration.workerStart', {
        from,
        terminal,
        spec
      })
      if (!response.ok) {
        return { ok: false, reason: response.error.message }
      }
      const receipt = readRecord(response.result)
      if (typeof receipt.lastError === 'string') {
        return { ok: false, reason: receipt.lastError }
      }
      if (typeof receipt.dispatchId !== 'string') {
        return { ok: false, reason: '编排没有返回派发编号。' }
      }
      return { ok: true, dispatchId: receipt.dispatchId }
    }
  }
}

/** Canvas actions run the same RPC methods the CLI and orchestration use, in-process. */
export function registerSessionCanvasActionHandlers(runtime: OrcaRuntimeService): void {
  const dispatcher = new RpcDispatcher({ runtime, methods: ALL_RPC_METHODS })
  const actions = createSessionCanvasActions({
    resolveTerminalHandle: (paneKey) => runtime.getTerminalHandleForPaneKey(paneKey),
    hasCurrentRun: (paneKey) => !!runtime.getOrchestrationDb().getCurrentRunForPane(paneKey),
    callRuntime: (method, params) =>
      dispatcher.dispatch(
        {
          id: `session-canvas-${randomUUID()}`,
          authToken: 'desktop-ipc',
          method,
          params,
          orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION
        },
        { clientId: 'session-canvas', clientKind: 'runtime' }
      )
  })
  const toFailure = (error: unknown): { ok: false; reason: string } => ({
    ok: false,
    reason: error instanceof Error ? error.message : String(error)
  })
  ipcMain.removeHandler('sessionCanvas:sendPrompt')
  ipcMain.handle('sessionCanvas:sendPrompt', (_event, args: SessionCanvasSendPromptArgs) =>
    actions.sendPrompt(args).catch(toFailure)
  )
  ipcMain.removeHandler('sessionCanvas:supervise')
  ipcMain.handle('sessionCanvas:supervise', (_event, args: SessionCanvasSuperviseArgs) =>
    actions.supervise(args).catch(toFailure)
  )
}

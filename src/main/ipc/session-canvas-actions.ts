import { randomUUID } from 'node:crypto'
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { RpcResponse } from '../runtime/rpc/core'
import { RpcDispatcher } from '../runtime/rpc/dispatcher'
import { ALL_RPC_METHODS } from '../runtime/rpc/methods'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../shared/protocol-version'
import { DESKTOP_RENDERER_RUNTIME_CLIENT_CAPABILITIES } from './desktop-renderer-runtime-capabilities'
import type {
  SessionCanvasSendPromptArgs,
  SessionCanvasSendPromptResult,
  SessionCanvasSuperviseArgs,
  SessionCanvasSuperviseResult
} from '../../shared/session-canvas-actions'

export type SessionCanvasRuntimeCallOptions = { requestId?: string }

export type SessionCanvasActionDeps = {
  resolveTerminalHandle: (paneKey: string) => string | null
  hasCurrentRun: (paneKey: string) => boolean
  callRuntime: (
    method: string,
    params: unknown,
    options?: SessionCanvasRuntimeCallOptions
  ) => Promise<RpcResponse>
}

type Failure = { ok: false; reason: string }

const RUN_OBJECTIVE_MAX_CHARS = 200
export const SUPERVISE_IN_FLIGHT_REASON = '正在派发，请稍候'

function fail(reason: string): Failure {
  return { ok: false, reason }
}

function unknownPane(paneKey: string): Failure {
  return fail(`找不到会话 ${paneKey} 的终端，它可能已关闭。`)
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? { ...value } : {}
}

export function parseSendPromptArgs(value: unknown): SessionCanvasSendPromptArgs | null {
  const { paneKey, text, keys } = readRecord(value)
  if (typeof paneKey !== 'string' || typeof text !== 'string') {
    return null
  }
  return keys === true ? { paneKey, text, keys } : { paneKey, text }
}

export function parseSuperviseArgs(value: unknown): SessionCanvasSuperviseArgs | null {
  const { coordinatorPaneKey, workerPaneKey, task } = readRecord(value)
  return typeof coordinatorPaneKey === 'string' &&
    typeof workerPaneKey === 'string' &&
    typeof task === 'string'
    ? { coordinatorPaneKey, workerPaneKey, task }
    : null
}

export function createSessionCanvasActions(deps: SessionCanvasActionDeps): {
  sendPrompt: (args: SessionCanvasSendPromptArgs) => Promise<SessionCanvasSendPromptResult>
  supervise: (args: SessionCanvasSuperviseArgs) => Promise<SessionCanvasSuperviseResult>
} {
  const inFlightSupervisions = new Set<string>()
  const runCreationByCoordinator = new Map<string, Promise<Failure | null>>()

  // Why: two drags from the same coordinator must not both see "no run" and create two runs.
  const ensureCoordinatorRun = (
    coordinatorPaneKey: string,
    from: string,
    objective: string,
    requestId: string
  ): Promise<Failure | null> => {
    const pending = runCreationByCoordinator.get(coordinatorPaneKey)
    if (pending) {
      return pending
    }
    const creation = (async (): Promise<Failure | null> => {
      if (deps.hasCurrentRun(coordinatorPaneKey)) {
        return null
      }
      const created = await deps.callRuntime(
        'orchestration.runCreate',
        { from, objective: objective.slice(0, RUN_OBJECTIVE_MAX_CHARS) },
        { requestId }
      )
      return created.ok ? null : fail(created.error.message)
    })().finally(() => runCreationByCoordinator.delete(coordinatorPaneKey))
    runCreationByCoordinator.set(coordinatorPaneKey, creation)
    return creation
  }

  const startWorker = async (
    args: SessionCanvasSuperviseArgs,
    spec: string
  ): Promise<SessionCanvasSuperviseResult> => {
    const from = deps.resolveTerminalHandle(args.coordinatorPaneKey)
    if (!from) {
      return unknownPane(args.coordinatorPaneKey)
    }
    const terminal = deps.resolveTerminalHandle(args.workerPaneKey)
    if (!terminal) {
      return unknownPane(args.workerPaneKey)
    }
    const attempt = randomUUID()
    const runFailure = await ensureCoordinatorRun(
      args.coordinatorPaneKey,
      from,
      spec,
      `session-canvas-run-${attempt}`
    )
    if (runFailure) {
      return runFailure
    }
    const response = await deps.callRuntime(
      'orchestration.workerStart',
      { from, terminal, spec },
      { requestId: `session-canvas-start-${attempt}` }
    )
    if (!response.ok) {
      return fail(response.error.message)
    }
    const receipt = readRecord(response.result)
    const dispatchId = typeof receipt.dispatchId === 'string' ? receipt.dispatchId : undefined
    if (typeof receipt.lastError === 'string') {
      return receipt.state === 'outcome_unknown' && dispatchId
        ? { ok: false, reason: receipt.lastError, dispatchId }
        : fail(receipt.lastError)
    }
    return dispatchId ? { ok: true, dispatchId } : fail('编排没有返回派发编号。')
  }

  return {
    async sendPrompt({ paneKey, text, keys }) {
      if (keys ? text.length === 0 : !text.trim()) {
        return fail('消息不能为空。')
      }
      const terminal = deps.resolveTerminalHandle(paneKey)
      if (!terminal) {
        return unknownPane(paneKey)
      }
      const client = { id: 'session-canvas', type: 'desktop' }
      // Why: terminal.send owns the settled-prompt vs plain-send choice and the lock/lease guards.
      // Approval choices are complete key sequences; Enter or paste wrapping would change them
      // (same as mobile's permission send).
      const response = await deps.callRuntime(
        'terminal.send',
        keys
          ? { terminal, text, client }
          : { terminal, text, enter: true, agentPrompt: true, client }
      )
      if (!response.ok) {
        return fail(response.error.message)
      }
      const send = readRecord(readRecord(response.result).send)
      if (send.accepted === true) {
        return { ok: true }
      }
      return fail(
        typeof send.refusedReason === 'string'
          ? send.refusedReason
          : send.agentSessionRefusal
            ? '该会话由结构化会话持有，当前不接受终端输入。'
            : '终端当前不接受输入。'
      )
    },

    async supervise(args) {
      const spec = args.task.trim()
      if (!spec) {
        return fail('任务说明不能为空。')
      }
      const key = `${args.coordinatorPaneKey}|${args.workerPaneKey}`
      if (inFlightSupervisions.has(key)) {
        return fail(SUPERVISE_IN_FLIGHT_REASON)
      }
      inFlightSupervisions.add(key)
      try {
        return await startWorker(args, spec)
      } finally {
        inFlightSupervisions.delete(key)
      }
    }
  }
}

function isMainFrame(event: IpcMainInvokeEvent): boolean {
  return event.senderFrame === event.sender.mainFrame
}

/** Canvas actions run the same RPC methods the CLI and orchestration use, in-process. */
export function registerSessionCanvasActionHandlers(runtime: OrcaRuntimeService): void {
  const dispatcher = new RpcDispatcher({ runtime, methods: ALL_RPC_METHODS })
  const actions = createSessionCanvasActions({
    resolveTerminalHandle: (paneKey) => runtime.getTerminalHandleForPaneKey(paneKey),
    hasCurrentRun: (paneKey) => !!runtime.getOrchestrationDb().getCurrentRunForPane(paneKey),
    callRuntime: (method, params, options) =>
      dispatcher.dispatch(
        {
          id: `session-canvas-${randomUUID()}`,
          authToken: 'desktop-ipc',
          method,
          params,
          // Why: a user-driven action on the current contract; runtime:call leaves this to its caller.
          orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
          ...(options?.requestId ? { orchestrationRequestId: options.requestId } : {})
        },
        {
          clientId: 'session-canvas',
          clientKind: 'runtime',
          clientCapabilities: DESKTOP_RENDERER_RUNTIME_CLIENT_CAPABILITIES
        }
      )
  })
  const toFailure = (error: unknown): Failure =>
    fail(error instanceof Error ? error.message : String(error))
  ipcMain.removeHandler('sessionCanvas:sendPrompt')
  ipcMain.handle('sessionCanvas:sendPrompt', async (event, value: unknown) => {
    if (!isMainFrame(event)) {
      return fail('请求必须来自当前窗口。')
    }
    const args = parseSendPromptArgs(value)
    return args ? actions.sendPrompt(args).catch(toFailure) : fail('发送参数无效。')
  })
  ipcMain.removeHandler('sessionCanvas:supervise')
  ipcMain.handle('sessionCanvas:supervise', async (event, value: unknown) => {
    if (!isMainFrame(event)) {
      return fail('请求必须来自当前窗口。')
    }
    const args = parseSuperviseArgs(value)
    return args ? actions.supervise(args).catch(toFailure) : fail('监督参数无效。')
  })
}

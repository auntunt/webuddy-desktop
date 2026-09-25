export type SessionCanvasSendPromptArgs = { paneKey: string; text: string }

export type SessionCanvasSendPromptResult = { ok: true } | { ok: false; reason: string }

export type SessionCanvasSuperviseArgs = {
  coordinatorPaneKey: string
  workerPaneKey: string
  task: string
}

export type SessionCanvasSuperviseResult =
  | { ok: true; dispatchId: string }
  | { ok: false; reason: string }

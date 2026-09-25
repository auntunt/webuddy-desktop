export type SessionCanvasSendPromptArgs = {
  paneKey: string
  text: string
  /** Write `text` as raw keystrokes (approval digit, ESC): no paste wrapping, no Enter. */
  keys?: true
}

export type SessionCanvasSendPromptResult = { ok: true } | { ok: false; reason: string }

export type SessionCanvasClosePaneArgs = { paneKey: string }

export type SessionCanvasClosePaneResult = { ok: true } | { ok: false; reason: string }

export type SessionCanvasSuperviseArgs = {
  coordinatorPaneKey: string
  workerPaneKey: string
  task: string
}

export type SessionCanvasSuperviseResult =
  | { ok: true; dispatchId: string }
  // Why: a dispatchId on failure means the preamble may already have reached the worker.
  | { ok: false; reason: string; dispatchId?: string }

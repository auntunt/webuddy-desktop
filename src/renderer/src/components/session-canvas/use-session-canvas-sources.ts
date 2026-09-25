import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { installWindowVisibilityInterval } from '@/lib/window-visibility-interval'
import type {
  SessionCanvasExternalSession,
  SessionCanvasMessage
} from '../../../../shared/session-canvas-types'
import { fetchChangedFilesForWorktrees } from './session-canvas-git-status'

export const SESSION_CANVAS_GIT_POLL_MS = 15_000
export const SESSION_CANVAS_MESSAGE_POLL_MS = 15_000
export const SESSION_CANVAS_EXTERNAL_POLL_MS = 60_000
// Older messages can't animate (10 min window) and only add `messaged` edges from the last day.
export const SESSION_CANVAS_MESSAGE_WINDOW_MS = 24 * 60 * 60 * 1000

export type SessionCanvasSources = {
  externalSessions: SessionCanvasExternalSession[]
  messages: SessionCanvasMessage[]
  changedFilesByWorktree: Record<string, string[]>
  now: number
  refreshMessages: () => void
}

const EMPTY_CHANGED: Record<string, string[]> = {}

// Why: polls usually return identical data; keeping the old reference skips a graph rebuild.
function keepIfEqual<T>(previous: T, next: T): T {
  return JSON.stringify(previous) === JSON.stringify(next) ? previous : next
}

/**
 * Polls the canvas's non-store sources while the window is visible; mounting is the
 * "page active" signal since the shell only renders the active page.
 */
export function useSessionCanvasSources(gitTargets: readonly string[]): SessionCanvasSources {
  const [externalSessions, setExternalSessions] = useState<SessionCanvasExternalSession[]>([])
  const [messages, setMessages] = useState<SessionCanvasMessage[]>([])
  const [changedFilesByWorktree, setChangedFiles] = useState(EMPTY_CHANGED)
  const [now, setNow] = useState(() => Date.now())
  const aliveRef = useRef(true)
  const reportedRef = useRef(new Set<string>())

  // Background polls repeat every few seconds; surface each distinct failure once.
  const reportFailure = useCallback((reason: string): void => {
    if (!reportedRef.current.has(reason)) {
      reportedRef.current.add(reason)
      toast.error(reason)
    }
  }, [])

  const reportRejection = useCallback(
    (error: unknown): void => {
      const reason = error instanceof Error && error.message ? error.message : String(error)
      reportFailure(
        translate('sessionCanvas.error.loadFailed', '会话画布数据加载失败：{{reason}}', { reason })
      )
    },
    [reportFailure]
  )

  // Why: a slow IPC must not stack a second request behind it on the next tick.
  const externalInFlightRef = useRef(false)
  const loadExternal = useCallback(async (): Promise<void> => {
    if (externalInFlightRef.current) {
      return
    }
    externalInFlightRef.current = true
    setNow(Date.now())
    try {
      const result = await window.api.sessionCanvas.listExternalSessions()
      if (!aliveRef.current) {
        return
      }
      if (result.ok) {
        setExternalSessions((previous) => keepIfEqual(previous, result.sessions))
      } else {
        reportFailure(result.reason)
      }
    } catch (error) {
      if (aliveRef.current) {
        reportRejection(error)
      }
    } finally {
      externalInFlightRef.current = false
    }
  }, [reportFailure, reportRejection])

  const messagesInFlightRef = useRef(0)
  const messagesRequestRef = useRef(0)
  const loadMessages = useCallback(
    async (force: boolean): Promise<void> => {
      if (messagesInFlightRef.current > 0 && !force) {
        return
      }
      const request = ++messagesRequestRef.current
      messagesInFlightRef.current++
      try {
        const result = await window.api.sessionCanvas.listMessages({
          sinceMs: Date.now() - SESSION_CANVAS_MESSAGE_WINDOW_MS
        })
        // A forced refresh may overtake a tick; only the newest request may publish.
        if (!aliveRef.current || request !== messagesRequestRef.current) {
          return
        }
        if (result.ok) {
          setMessages((previous) => keepIfEqual(previous, result.messages))
        } else {
          reportFailure(result.reason)
        }
      } catch (error) {
        if (aliveRef.current) {
          reportRejection(error)
        }
      } finally {
        messagesInFlightRef.current--
      }
    },
    [reportFailure, reportRejection]
  )

  useEffect(() => {
    aliveRef.current = true
    const stopExternal = installWindowVisibilityInterval({
      run: () => void loadExternal(),
      intervalMs: SESSION_CANVAS_EXTERNAL_POLL_MS
    })
    const stopMessages = installWindowVisibilityInterval({
      run: () => void loadMessages(false),
      intervalMs: SESSION_CANVAS_MESSAGE_POLL_MS
    })
    return () => {
      aliveRef.current = false
      stopExternal()
      stopMessages()
    }
  }, [loadExternal, loadMessages])

  // Why: keyed on the joined ids so a graph rebuild with the same worktrees keeps the timer.
  const gitTargetsKey = gitTargets.join('\n')
  useEffect(() => {
    const targets = gitTargetsKey ? gitTargetsKey.split('\n') : []
    if (targets.length === 0) {
      setChangedFiles(EMPTY_CHANGED)
      return
    }
    let active = true
    let inFlight = false
    const run = (): void => {
      if (inFlight) {
        return
      }
      inFlight = true
      void fetchChangedFilesForWorktrees(targets)
        .then((changed) => {
          if (active) {
            setChangedFiles((previous) => keepIfEqual(previous, changed))
          }
        })
        .catch(() => {})
        .finally(() => {
          inFlight = false
        })
    }
    const stop = installWindowVisibilityInterval({ run, intervalMs: SESSION_CANVAS_GIT_POLL_MS })
    return () => {
      active = false
      stop()
    }
  }, [gitTargetsKey])

  const refreshMessages = useCallback(() => {
    void loadMessages(true)
  }, [loadMessages])

  return { externalSessions, messages, changedFilesByWorktree, now, refreshMessages }
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { selectGitStatusTargets } from './session-canvas-git-targets-model'
import {
  loadSessionCanvasPositions,
  saveSessionCanvasPositions,
  withSavedPosition
} from './session-canvas-positions-storage'
import { normalizeCanvasAgent } from './session-graph-membership-model'
import { buildSessionGraph, collectGraphPositions, toStoredPosition } from './session-graph-model'
import type { SessionCanvasFilters, SessionGraph } from './session-graph-types'
import type { CanvasPoint } from './session-layout-model'
import { useSessionCanvasSources } from './use-session-canvas-sources'

export {
  SESSION_CANVAS_EXTERNAL_POLL_MS,
  SESSION_CANVAS_GIT_POLL_MS,
  SESSION_CANVAS_MESSAGE_POLL_MS
} from './use-session-canvas-sources'

export type SessionCanvasData = {
  graph: SessionGraph
  /** Normalized agent ids present on the canvas, for the agent filter. */
  agentOptions: string[]
  /** Persists a user-dragged node at its rendered (React Flow) position. */
  savePosition: (nodeId: string, rendered: CanvasPoint) => void
  /** Drops saved and remembered positions so everything is auto-placed again. */
  resetLayout: () => void
  refreshMessages: () => void
}

/** Store snapshot + polled sources → memoized session graph with stable, persisted layout. */
export function useSessionCanvasData(filters: SessionCanvasFilters): SessionCanvasData {
  // Why: the same store slice the dashboard reads; the store owns the IPC subscription.
  const agentStatusByPaneKey = useAppStore((s) => s.agentStatusByPaneKey)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const liveEntries = useMemo(() => Object.values(agentStatusByPaneKey), [agentStatusByPaneKey])
  const repoIdByWorktree = useMemo(() => {
    const index: Record<string, string> = {}
    for (const worktrees of Object.values(worktreesByRepo)) {
      for (const worktree of worktrees) {
        index[worktree.id] ??= worktree.repoId
      }
    }
    return index
  }, [worktreesByRepo])
  const gitTargets = useMemo(
    () => selectGitStatusTargets(liveEntries, repoIdByWorktree),
    [liveEntries, repoIdByWorktree]
  )
  const { externalSessions, messages, changedFilesByWorktree, now, refreshMessages } =
    useSessionCanvasSources(gitTargets)

  const [savedPositions, setSavedPositions] = useState(loadSessionCanvasPositions)
  const [layoutGeneration, setLayoutGeneration] = useState(0)
  // Why: last frame's positions keep auto-placed cards still as others come and go (not state:
  // feeding it back through state would rebuild the graph a second time per change).
  const previousPositionsRef = useRef<Record<string, CanvasPoint>>({})

  const graph = useMemo(
    () =>
      buildSessionGraph({
        liveEntries,
        externalSessions,
        changedFilesByWorktree,
        repoIdByWorktree,
        messages,
        savedPositions,
        previousPositions: previousPositionsRef.current,
        filters,
        now
      }),
    // layoutGeneration: a reset must rebuild even when no data input changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      liveEntries,
      externalSessions,
      changedFilesByWorktree,
      repoIdByWorktree,
      messages,
      savedPositions,
      filters,
      now,
      layoutGeneration
    ]
  )
  useEffect(() => {
    previousPositionsRef.current = collectGraphPositions(graph)
  }, [graph])

  const savePosition = useCallback(
    (nodeId: string, rendered: CanvasPoint) => {
      const stored = toStoredPosition(graph, nodeId, rendered)
      setSavedPositions((current) => {
        const next = withSavedPosition(current, nodeId, stored)
        saveSessionCanvasPositions(next)
        return next
      })
    },
    [graph]
  )

  const resetLayout = useCallback(() => {
    previousPositionsRef.current = {}
    saveSessionCanvasPositions({})
    setSavedPositions({})
    setLayoutGeneration((generation) => generation + 1)
  }, [])

  const agentOptions = useMemo(() => {
    const agents = new Set<string>()
    for (const entry of liveEntries) {
      agents.add(normalizeCanvasAgent(entry.agentType))
    }
    for (const session of externalSessions) {
      agents.add(normalizeCanvasAgent(session.agent))
    }
    return [...agents].sort()
  }, [liveEntries, externalSessions])

  return { graph, agentOptions, savePosition, resetLayout, refreshMessages }
}

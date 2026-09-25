import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { indexRepoIdByWorktree, selectGitStatusTargets } from './session-canvas-git-targets-model'
import {
  SESSION_CANVAS_POSITIONS_KEY,
  loadSessionCanvasPositions,
  mergeRememberedPositions,
  saveSessionCanvasPositions,
  withSavedPosition
} from './session-canvas-positions-storage'
import { normalizeCanvasAgent, resolveCanvasMembership } from './session-graph-membership-model'
import { buildSessionGraph, collectGraphPositions, toStoredPosition } from './session-graph-model'
import type { SessionCanvasFilters, SessionGraph } from './session-graph-types'
import type { CanvasPoint } from './session-layout-model'
import { useSessionCanvasSources } from './use-session-canvas-sources'

export {
  SESSION_CANVAS_EXTERNAL_POLL_MS,
  SESSION_CANVAS_GIT_POLL_MS,
  SESSION_CANVAS_MESSAGE_POLL_MS
} from './use-session-canvas-sources'

export type SessionCanvasProjectOption = { id: string; label: string }

export type SessionCanvasData = {
  graph: SessionGraph
  /** Normalized agent ids present on the canvas, for the agent filter. */
  agentOptions: string[]
  /** Groups the canvas would show ignoring the project filter (id = group id). */
  projectOptions: SessionCanvasProjectOption[]
  /** Persists a user-dragged node at its rendered (React Flow) position. */
  savePosition: (nodeId: string, rendered: CanvasPoint) => void
  /** Drops saved and remembered positions so everything is auto-placed again. */
  resetLayout: () => void
  refreshMessages: () => void
}

const NO_GIT_TARGETS: string[] = []

/**
 * Store snapshot + polled sources → memoized session graph with stable, persisted layout.
 * `mirroredChangedFiles` (pop-out) replaces the local git poll with the main window's result.
 */
export function useSessionCanvasData(
  filters: SessionCanvasFilters,
  mirroredChangedFiles?: Record<string, string[]>
): SessionCanvasData {
  // Why: the same store slice the dashboard reads; the store owns the IPC subscription.
  const agentStatusByPaneKey = useAppStore((s) => s.agentStatusByPaneKey)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const liveEntries = useMemo(() => Object.values(agentStatusByPaneKey), [agentStatusByPaneKey])
  const repoIdByWorktree = useMemo(() => indexRepoIdByWorktree(worktreesByRepo), [worktreesByRepo])
  const gitTargets = useMemo(
    () => selectGitStatusTargets(liveEntries, repoIdByWorktree),
    [liveEntries, repoIdByWorktree]
  )
  const sources = useSessionCanvasSources(mirroredChangedFiles ? NO_GIT_TARGETS : gitTargets)
  const { externalSessions, messages, now, refreshMessages } = sources
  const changedFilesByWorktree = mirroredChangedFiles ?? sources.changedFilesByWorktree

  const [savedPositions, setSavedPositions] = useState(loadSessionCanvasPositions)
  const [layoutGeneration, setLayoutGeneration] = useState(0)
  // Why: the main window and the pop-out share this storage; follow the other one's drags.
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === SESSION_CANVAS_POSITIONS_KEY || event.key === null) {
        setSavedPositions(loadSessionCanvasPositions())
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
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
    previousPositionsRef.current = mergeRememberedPositions(
      previousPositionsRef.current,
      collectGraphPositions(graph)
    )
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

  const projectOptions = useMemo((): SessionCanvasProjectOption[] => {
    const options: SessionCanvasProjectOption[] = []
    if (filters.projects.length === 0) {
      for (const node of graph.nodes) {
        if ('label' in node.data) {
          options.push({ id: node.id, label: node.data.label })
        }
      }
      return options
    }
    // Why: with a project picked, the graph lacks the other groups the menu must still offer.
    const { groupLabels } = resolveCanvasMembership({
      liveEntries,
      externalSessions,
      changedFilesByWorktree: {},
      repoIdByWorktree,
      messages: [],
      savedPositions: {},
      previousPositions: {},
      filters: { ...filters, projects: [] },
      now
    })
    for (const [id, label] of groupLabels) {
      options.push({ id, label })
    }
    return options
  }, [graph, filters, liveEntries, externalSessions, repoIdByWorktree, now])

  return { graph, agentOptions, projectOptions, savePosition, resetLayout, refreshMessages }
}

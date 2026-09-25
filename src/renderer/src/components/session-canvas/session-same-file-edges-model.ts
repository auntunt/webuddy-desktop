import { splitWorktreeIdForFilesystem } from '../../../../shared/worktree/id'
import type { CanvasSession, SessionGraphEdge } from './session-graph-types'
import { collectTouchedFiles } from './session-touched-files-model'

export const SAME_FILE_EDGE_MAX_FILES = 20

type WorktreeMembers = { worktreeId: string; sessions: CanvasSession[] }

const LOCKFILE_NAMES = new Set(['pnpm-lock.yaml', 'package-lock.json', 'go.sum'])

// Why: every dependency bump rewrites these, so they would link unrelated worktrees.
export function isLockfileNoise(file: string): boolean {
  const name = file.slice(Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')) + 1)
  return LOCKFILE_NAMES.has(name) || name.endsWith('.lock')
}

function recencyOf(session: CanvasSession): [number, number] {
  return session.data.kind === 'live'
    ? [session.data.entry.updatedAt, session.data.entry.stateStartedAt]
    : [0, 0]
}

/** The worktree's most recently active session stands in for it on cross-worktree edges. */
function mostRecentSession(sessions: CanvasSession[]): CanvasSession {
  return sessions.reduce((best, candidate) => {
    const [bestUpdated, bestStarted] = recencyOf(best)
    const [updated, started] = recencyOf(candidate)
    return updated > bestUpdated || (updated === bestUpdated && started > bestStarted)
      ? candidate
      : best
  })
}

function sameFileEdge(a: string, b: string, files: string[]): SessionGraphEdge {
  const [source, target] = a < b ? [a, b] : [b, a]
  return {
    id: `same-file:${source}|${target}`,
    source,
    target,
    kind: 'same-file',
    animated: false,
    files
  }
}

/**
 * Shared changed files per worktree pair via an inverted index, so cost scales with
 * actual overlaps rather than worktrees² × files. Key is `${i}:${j}` with i < j.
 */
function sharedFilesByWorktreePair(fileLists: string[][]): Map<string, string[]> {
  const pairs = new Map<string, string[]>()
  // Why: most files live in one worktree; a bare index avoids 100k+ tiny arrays.
  const worktreesByFile = new Map<string, number | number[]>()
  const totalPairs = (fileLists.length * (fileLists.length - 1)) / 2
  let saturated = 0
  const addShared = (u: number, w: number, file: string): void => {
    const key = `${u}:${w}`
    const shared = pairs.get(key) ?? []
    if (shared.length < SAME_FILE_EDGE_MAX_FILES) {
      shared.push(file)
      pairs.set(key, shared)
      if (shared.length === SAME_FILE_EDGE_MAX_FILES) {
        saturated++
      }
    }
  }
  for (let w = 0; w < fileLists.length && saturated < totalPairs; w++) {
    for (const file of fileLists[w]) {
      const earlier = worktreesByFile.get(file)
      if (earlier === undefined) {
        worktreesByFile.set(file, w)
      } else if (typeof earlier === 'number') {
        if (earlier !== w) {
          addShared(earlier, w, file)
          worktreesByFile.set(file, [earlier, w])
        }
      } else if (earlier.at(-1) !== w) {
        for (const u of earlier) {
          addShared(u, w, file)
        }
        earlier.push(w)
      }
    }
  }
  return pairs
}

function crossWorktreeEdges(
  worktrees: WorktreeMembers[],
  changed: Record<string, string[]>
): SessionGraphEdge[] {
  const edges: SessionGraphEdge[] = []
  const pairs = sharedFilesByWorktreePair(
    worktrees.map((w) => (changed[w.worktreeId] ?? []).filter((file) => !isLockfileNoise(file)))
  )
  const representatives = worktrees.map((w) => mostRecentSession(w.sessions))
  // Why one edge per pair: 10 sessions × 10 sessions would otherwise draw 100 identical edges.
  for (const [key, files] of pairs) {
    const [u, w] = key.split(':').map(Number)
    edges.push(sameFileEdge(representatives[u].id, representatives[w].id, files))
  }
  return edges
}

/** Hosts whose default filesystems fold case, so `src/App.ts` and `src/app.ts` are one file. */
function foldsPathCase(platform: string): boolean {
  return platform === 'win32' || platform === 'darwin'
}

function currentClientPlatform(): string {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent
  return agent.includes('Mac') ? 'darwin' : agent.includes('Windows') ? 'win32' : 'linux'
}

// Why: sessions sharing one worktree share its whole git status, so only the files each
// session itself edited (per its action feed) say whether they collide.
function sameWorktreeEdges(worktree: WorktreeMembers, foldCase: boolean): SessionGraphEdge[] {
  if (worktree.sessions.length < 2) {
    return []
  }
  const root = splitWorktreeIdForFilesystem(worktree.worktreeId)?.worktreePath ?? null
  // Comparison key → first spelling seen, so edges show the path as the agent wrote it.
  const touched = worktree.sessions.map((session) => {
    const history = session.data.kind === 'live' ? session.data.entry.actionHistory : undefined
    const files = new Map<string, string>()
    for (const file of collectTouchedFiles(history, root)) {
      const key = foldCase ? file.toLowerCase() : file
      if (!files.has(key)) {
        files.set(key, file)
      }
    }
    return { id: session.id, files }
  })
  const edges: SessionGraphEdge[] = []
  for (let i = 0; i < touched.length; i++) {
    const left = touched[i].files
    for (let j = i + 1; j < touched.length; j++) {
      const shared: string[] = []
      for (const key of touched[j].files.keys()) {
        const display = left.get(key)
        if (display !== undefined && shared.push(display) === SAME_FILE_EDGE_MAX_FILES) {
          break
        }
      }
      if (shared.length > 0) {
        edges.push(sameFileEdge(touched[i].id, touched[j].id, shared))
      }
    }
  }
  return edges
}

export function buildSameFileEdges(
  sessions: CanvasSession[],
  changedFilesByWorktree: Record<string, string[]>,
  platform: string = currentClientPlatform()
): SessionGraphEdge[] {
  const foldCase = foldsPathCase(platform)
  const worktreesByRepo = new Map<string, Map<string, WorktreeMembers>>()
  for (const session of sessions) {
    const worktreeId = session.data.kind === 'live' ? session.data.entry.worktreeId : undefined
    if (!session.repoId || !worktreeId) {
      continue
    }
    const worktrees = worktreesByRepo.get(session.repoId) ?? new Map<string, WorktreeMembers>()
    worktreesByRepo.set(session.repoId, worktrees)
    const members = worktrees.get(worktreeId) ?? { worktreeId, sessions: [] }
    worktrees.set(worktreeId, members)
    members.sessions.push(session)
  }
  const edges: SessionGraphEdge[] = []
  for (const worktrees of worktreesByRepo.values()) {
    const list = [...worktrees.values()]
    edges.push(...crossWorktreeEdges(list, changedFilesByWorktree))
    for (const worktree of list) {
      edges.push(...sameWorktreeEdges(worktree, foldCase))
    }
  }
  return edges
}

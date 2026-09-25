import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import { splitWorktreeId } from '../../../../shared/worktree/id'
import type { Worktree } from '../../../../shared/worktree/types'

/**
 * Worktrees whose git status can produce a same-file edge: those hosting a live session,
 * and only in repos with two or more such worktrees (co-located sessions compare their own
 * action feeds instead). Filters are ignored so toggling them never restarts polling.
 * Sorted so callers can key on the joined list.
 */
export function selectGitStatusTargets(
  liveEntries: readonly AgentStatusEntry[],
  repoIdByWorktree: Record<string, string>
): string[] {
  const worktreesByRepo = new Map<string, Set<string>>()
  for (const { worktreeId } of liveEntries) {
    const repoId = worktreeId
      ? (repoIdByWorktree[worktreeId] ?? splitWorktreeId(worktreeId)?.repoId)
      : undefined
    if (!worktreeId || !repoId) {
      continue
    }
    const worktrees = worktreesByRepo.get(repoId) ?? new Set<string>()
    worktreesByRepo.set(repoId, worktrees)
    worktrees.add(worktreeId)
  }
  const targets: string[] = []
  for (const worktrees of worktreesByRepo.values()) {
    if (worktrees.size >= 2) {
      targets.push(...worktrees)
    }
  }
  return targets.sort()
}

/** worktreeId → repoId across every known worktree (first repo wins on a duplicate id). */
export function indexRepoIdByWorktree(
  worktreesByRepo: Record<string, readonly Pick<Worktree, 'id' | 'repoId'>[]>
): Record<string, string> {
  const index: Record<string, string> = {}
  for (const worktrees of Object.values(worktreesByRepo)) {
    for (const worktree of worktrees) {
      index[worktree.id] ??= worktree.repoId
    }
  }
  return index
}

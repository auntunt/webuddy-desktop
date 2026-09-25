import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import { liveSessionHostVerdict, liveSessionTitle } from './live-session-card-model'
import { latestSessionResult, type ResolvedSessionConnection } from './session-connect-model'

function useIsUnverifiable(entry: AgentStatusEntry): boolean {
  const { connectionId } = entry
  const status = useAppStore((state) =>
    connectionId ? (state.sshConnectionStates.get(connectionId)?.status ?? null) : null
  )
  return liveSessionHostVerdict(connectionId, status) === 'unverifiable'
}

function unverifiableReason(entry: AgentStatusEntry): string {
  return translate(
    'sessionCanvas.connect.hostUnverifiable',
    '无法确认「{{title}}」所在主机的连接，暂时不能发送。',
    { title: liveSessionTitle(entry) }
  )
}

/** Why a drag-wired action can't be sent right now, or null when it can. */
export function useSessionConnectionBlock(
  connection: ResolvedSessionConnection,
  kind: 'pass-along' | 'supervise'
): string | null {
  const targetUnverifiable = useIsUnverifiable(connection.to)
  const sourceUnverifiable = useIsUnverifiable(connection.from)
  if (targetUnverifiable) {
    return unverifiableReason(connection.to)
  }
  if (kind === 'supervise') {
    return null
  }
  // Why: A's result is read from its host's status feed, which is stale while unreachable.
  if (sourceUnverifiable) {
    return unverifiableReason(connection.from)
  }
  return latestSessionResult(connection.from)?.trim()
    ? null
    : translate('sessionCanvas.passAlong.noResult', '「{{title}}」还没有可传的结果。', {
        title: liveSessionTitle(connection.from)
      })
}

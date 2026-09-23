import { useEffect, useState } from 'react'
import { translate } from '@/i18n/i18n'
import { formatUiRelativeTimeFromDate } from '@/i18n/relative-time-format'
import type { WebuddyCollectorStatus } from '../../../../shared/webuddy-collector'

function lastPushProblem(lastPush: WebuddyCollectorStatus['lastPush']): string | null {
  if (lastPush?.authRejected) {
    return translate('webuddyCollector.authRejected', '上报凭证已失效，请重新登录')
  }
  if (lastPush?.error) {
    return translate('webuddyCollector.lastPushError', '上次上报失败：{{error}}', {
      error: lastPush.error
    })
  }
  return null
}

/** Usage-upload health for the signed-in account; read once per pane open. */
export function WebuddyCollectorStatusSection(): React.JSX.Element {
  const [status, setStatus] = useState<WebuddyCollectorStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api.webuddyCollector
      .status()
      .then((next) => {
        if (!cancelled) {
          setStatus(next)
        }
      })
      .catch((error: unknown) => console.error('[webuddy] 读取上报状态失败:', error))
    return () => {
      cancelled = true
    }
  }, [])

  const lastPush = status?.lastPush ?? null
  const problem = lastPushProblem(lastPush)

  return (
    <div className="space-y-2 border-t border-border/60 pt-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
        {translate('webuddyCollector.title', '使用数据上报')}
      </p>
      {status === null ? null : !status.linked || !lastPush ? (
        <p className="text-xs text-muted-foreground">
          {translate('webuddyCollector.notStarted', '尚未开始上报')}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {translate('webuddyCollector.lastPush', '上次上报：{{when}}，成功 {{total}} 条', {
            when: formatUiRelativeTimeFromDate(lastPush.at),
            total: lastPush.pushed
          })}
        </p>
      )}
      {status?.linked ? (
        <p className="text-xs text-muted-foreground">
          {translate('webuddyCollector.pending', '待上报：{{total}} 条', {
            total: status.pending
          })}
        </p>
      ) : null}
      {status?.linked && problem ? <p className="text-xs text-destructive">{problem}</p> : null}
    </div>
  )
}

import type { ReactNode } from 'react'
import type { InsightsOverall } from '../api/session-types'
import { StatusLine } from '../components/QueryStatus'
import { formatDuration } from '../format/duration-format'
import { formatCount, formatTokens } from '../format/number-format'

type Kpi = { label: string; value: string; hint: ReactNode; title?: string }

function kpisOf(o: InsightsOverall): Kpi[] {
  const clamped = o.clamped_sessions
  return [
    {
      label: '会话数',
      value: formatCount(o.sessions),
      hint: `${formatCount(o.turns)} 轮 · ${formatCount(o.messages)} 条消息`
    },
    {
      label: '活跃天数',
      value: formatCount(o.active_days),
      hint: `日均 ${o.avg_sessions_per_active_day} 个会话`
    },
    {
      label: '累计时长',
      value: formatDuration(o.duration_ms),
      hint: clamped ? `单会话封顶 12 小时 · ${clamped} 个已封顶` : '单会话封顶 12 小时',
      title: clamped
        ? `${clamped} 个会话首尾跨度超过 12 小时（多为长期追加的会话文件），按 12 小时计入`
        : '单个会话最多计入 12 小时'
    },
    {
      label: 'token',
      value: formatTokens(o.tokens),
      hint: o.tokens ? '各 agent 上报的合计' : '所选会话没有上报 token'
    },
    {
      label: '项目数',
      value: formatCount(o.projects),
      hint: o.first_day ? `${o.first_day} 至 ${o.last_day}` : '—'
    }
  ]
}

export function KpiRow({
  overall,
  isPending,
  error
}: {
  overall: InsightsOverall | undefined
  isPending: boolean
  error: Error | null
}) {
  if (!overall) {
    return (
      <div className="rounded-card border border-line bg-card">
        <StatusLine tone={error ? 'bad' : undefined}>
          {error ? `指标加载失败：${error.message}` : isPending ? '加载中…' : '没有数据'}
        </StatusLine>
      </div>
    )
  }
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {kpisOf(overall).map((kpi) => (
        <section
          key={kpi.label}
          aria-label={kpi.label}
          title={kpi.title}
          className="rounded-card border border-line bg-card px-4 py-3.5"
        >
          <h2 className="text-[11px] font-semibold tracking-wider text-faint uppercase">
            {kpi.label}
          </h2>
          <p className="mt-1.5 font-mono text-2xl font-semibold tracking-tight tabular-nums">
            {kpi.value}
          </p>
          <p className="mt-1 truncate text-xs text-dim">{kpi.hint}</p>
        </section>
      ))}
    </div>
  )
}

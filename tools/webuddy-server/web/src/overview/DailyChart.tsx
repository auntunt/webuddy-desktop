import {
  Bar,
  BarChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps
} from 'recharts'
import type { StatsGroup } from '../api/session-types'
import { QueryStatus } from '../components/QueryStatus'
import { Card } from '../components/ui/Card'
import { formatDuration } from '../format/duration-format'
import { formatCount } from '../format/number-format'
import { fillDailySeries, type DailyPoint } from './daily-series'

const AXIS_TICK = { fill: 'var(--color-faint)', fontSize: 11 }

type DailyChartProps = {
  groups: StatsGroup[] | undefined
  isPending: boolean
  error: Error | null
  start?: string
  end?: string
  onSelectDay: (day: string) => void
}

export function DailyChart({ groups, isPending, error, start, end, onSelectDay }: DailyChartProps) {
  const hasData = (groups ?? []).length > 0
  const series = hasData ? fillDailySeries(groups ?? [], start, end) : []
  return (
    <Card
      title="按天"
      actions={<span className="text-xs text-dim">会话数 · 点击柱子筛选当天</span>}
    >
      <QueryStatus isPending={isPending} error={error} isEmpty={!hasData}>
        <BarChart
          responsive
          data={series}
          margin={{ top: 4, right: 4, bottom: 0, left: -18 }}
          style={{ width: '100%', height: 220 }}
          accessibilityLayer
        >
          <CartesianGrid vertical={false} stroke="var(--color-line)" />
          <XAxis
            dataKey="day"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: 'var(--color-line-strong)' }}
            tickFormatter={(day: string) => day.slice(5)}
            minTickGap={16}
          />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip cursor={{ fill: 'var(--color-hover)' }} content={DayTooltip} />
          <Bar
            dataKey="sessions"
            name="会话数"
            fill="var(--color-accent)"
            radius={[4, 4, 0, 0]}
            maxBarSize={28}
            cursor="pointer"
            onClick={(entry) => {
              const day: unknown = entry.payload?.day
              if (typeof day === 'string') {
                onSelectDay(day)
              }
            }}
          />
        </BarChart>
      </QueryStatus>
    </Card>
  )
}

function DayTooltip({ active, payload }: TooltipContentProps) {
  const point: DailyPoint | undefined = payload?.[0]?.payload
  if (!active || !point) {
    return null
  }
  return (
    <div className="rounded-control border border-line-strong bg-card px-2.5 py-1.5 text-xs">
      <p className="font-mono text-fg">{point.day}</p>
      <p className="text-dim">
        {formatCount(point.sessions)} 个会话 · {formatDuration(point.duration_ms)}
      </p>
    </div>
  )
}

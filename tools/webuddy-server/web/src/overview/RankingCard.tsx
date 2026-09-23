import { useState } from 'react'
import type { StatsGroup } from '../api/session-types'
import { QueryStatus } from '../components/QueryStatus'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { cx } from '../components/ui/class-names'
import { formatCount } from '../format/number-format'

const TOP = 10

const asIs = (key: string) => key

type RankingCardProps = {
  title: string
  groups: StatsGroup[] | undefined
  isPending: boolean
  error: Error | null
  activeKey: string | undefined
  label?: (key: string) => string
  onSelect: (key: string) => void
}

/** Top-N bars; the rest sits behind an explicit "展开全部" instead of being silently cut. */
export function RankingCard({
  title,
  groups,
  isPending,
  error,
  activeKey,
  label = asIs,
  onSelect
}: RankingCardProps) {
  const [expanded, setExpanded] = useState(false)
  const rows = (groups ?? []).filter((g): g is StatsGroup & { key: string } => g.key !== null)
  const visible = expanded ? rows : rows.slice(0, TOP)
  const max = Math.max(1, ...rows.map((r) => r.sessions))
  return (
    <Card title={title}>
      <QueryStatus isPending={isPending} error={error} isEmpty={rows.length === 0}>
        <ul
          className={cx('flex flex-col gap-0.5', expanded && 'max-h-[320px] overflow-y-auto pr-1')}
        >
          {visible.map((row) => (
            <li key={row.key}>
              <button
                type="button"
                title={`${row.key}（点击筛选）`}
                aria-pressed={activeKey === row.key}
                onClick={() => onSelect(row.key)}
                className={cx(
                  'grid w-full cursor-pointer grid-cols-[minmax(0,9rem)_1fr_3.5rem] items-center gap-3 rounded-control px-1.5 py-1 text-left text-[12.5px] transition-colors hover:bg-hover',
                  activeKey === row.key && 'bg-raised'
                )}
              >
                <span className="truncate font-mono">{label(row.key)}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-raised">
                  <span
                    className="block h-full rounded-full bg-accent"
                    style={{ width: `${Math.max(2, Math.round((row.sessions / max) * 100))}%` }}
                  />
                </span>
                <span className="text-right font-mono text-dim tabular-nums">
                  {formatCount(row.sessions)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {rows.length > TOP && (
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setExpanded(!expanded)}>
            {expanded ? '收起' : `展开全部 ${formatCount(rows.length)} 项`}
          </Button>
        )}
      </QueryStatus>
    </Card>
  )
}

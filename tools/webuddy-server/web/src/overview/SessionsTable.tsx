import { useNavigate } from 'react-router'
import type { SessionListItem } from '../api/session-types'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Table, Td, Th, Tr } from '../components/ui/Table'
import { formatDuration } from '../format/duration-format'
import { formatCount, formatTokens } from '../format/number-format'
import { shortPath } from '../format/path-format'

export function sessionPath(key: string): string {
  return `/sessions/${encodeURIComponent(key)}`
}

type SessionsTableProps = {
  items: SessionListItem[]
  total: number
  offset: number
  limit: number
  onOffsetChange: (offset: number) => void
}

export function SessionsTable({ items, total, offset, limit, onOffsetChange }: SessionsTableProps) {
  const navigate = useNavigate()
  const open = (key: string) => navigate(sessionPath(key))
  return (
    <div className="flex flex-col gap-3">
      <Table>
        <thead>
          <tr>
            <Th>日期</Th>
            <Th>人</Th>
            <Th>agent / 模型</Th>
            <Th>项目</Th>
            <Th>分支</Th>
            <Th className="text-right">轮次</Th>
            <Th className="text-right">token</Th>
            <Th className="text-right">时长</Th>
            <Th>正文</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <Tr
              key={row.dedupe_key}
              tabIndex={0}
              aria-label={`${row.local_date} ${row.user_id} 的会话`}
              className="cursor-pointer focus:bg-hover focus:outline-none"
              onClick={() => open(row.dedupe_key)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  open(row.dedupe_key)
                }
              }}
            >
              <Td className="font-mono whitespace-nowrap">{row.local_date}</Td>
              <Td className="whitespace-nowrap">{row.user_id}</Td>
              <Td>
                <div className="flex items-center gap-1.5 whitespace-nowrap">
                  <Badge>{row.agent_label || row.agent_id}</Badge>
                  <span className="font-mono text-dim">{row.agent_model || '—'}</span>
                </div>
              </Td>
              <Td className="font-mono whitespace-nowrap">
                <span title={row.cwd ?? undefined}>{shortPath(row.cwd)}</span>
              </Td>
              <Td
                className="max-w-[180px] truncate font-mono text-dim"
                title={row.branch ?? undefined}
              >
                {row.branch || '—'}
              </Td>
              <Td className="text-right font-mono">{formatCount(row.turn_count)}</Td>
              <Td className="text-right font-mono text-dim">{formatTokens(row.tokens_total)}</Td>
              <Td className="text-right font-mono whitespace-nowrap text-dim">
                {formatDuration(row.duration_ms)}
              </Td>
              <Td>
                {row.transcript_truncated ? (
                  <Badge tone="warn">截断</Badge>
                ) : (
                  <Badge tone="ok">完整</Badge>
                )}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <Pager total={total} offset={offset} limit={limit} onOffsetChange={onOffsetChange} />
    </div>
  )
}

function Pager({ total, offset, limit, onOffsetChange }: Omit<SessionsTableProps, 'items'>) {
  const first = total === 0 ? 0 : offset + 1
  const last = Math.min(offset + limit, total)
  const pages = Math.max(1, Math.ceil(total / limit))
  const current = Math.floor(offset / limit) + 1
  return (
    <div className="flex items-center justify-between gap-3 text-xs text-dim">
      <span>
        第 {first}–{last} 条，共 {formatCount(total)} 条 · 第 {current} / {pages} 页
      </span>
      <span className="flex gap-1.5">
        <Button
          size="sm"
          disabled={offset === 0}
          onClick={() => onOffsetChange(Math.max(0, offset - limit))}
        >
          上一页
        </Button>
        <Button size="sm" disabled={last >= total} onClick={() => onOffsetChange(offset + limit)}>
          下一页
        </Button>
      </span>
    </div>
  )
}

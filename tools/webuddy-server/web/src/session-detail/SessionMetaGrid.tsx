import type { SessionDetail } from '../api/session-types'
import { formatDate, formatDateTime } from '../format/date-format'
import { formatDuration } from '../format/duration-format'
import { formatBytes, formatCount, formatTokens } from '../format/number-format'

type Field = [label: string, value: string | null | undefined]

/** Same grouping as the old drawer: who / when / how much / where / compliance. */
function sectionsOf(s: SessionDetail): [title: string, fields: Field[]][] {
  return [
    [
      '身份',
      [
        ['人员', s.user_id],
        ['设备', s.device_label || s.hostname],
        ['agent', [s.agent_label || s.agent_id, s.agent_version].filter(Boolean).join(' ')],
        ['模型', s.agent_model]
      ]
    ],
    [
      '时间',
      [
        ['日期', formatDate(s.local_date)],
        ['开始', formatDateTime(s.started_at)],
        ['结束', formatDateTime(s.ended_at)],
        ['时长', formatDuration(s.duration_ms)],
        ['接收', formatDateTime(s.received_at)]
      ]
    ],
    [
      '规模',
      [
        ['轮次 / 消息', `${formatCount(s.turn_count)} / ${formatCount(s.message_count)}`],
        ['token', formatTokens(s.tokens_total)],
        ['正文体积', formatBytes(s.transcript_bytes)]
      ]
    ],
    [
      '位置',
      [
        ['项目', s.cwd],
        ['分支', s.branch],
        ['会话 id', s.session_id]
      ]
    ],
    [
      '合规',
      [
        ['采集范围', s.consent_scope],
        ['脱敏规则', s.redaction_rules || '（无命中）'],
        ['正文指纹', s.transcript_sha256],
        ['是否截断', s.transcript_truncated ? '是' : '否']
      ]
    ]
  ]
}

export function SessionMetaGrid({ session }: { session: SessionDetail }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {sectionsOf(session).map(([title, fields]) => (
        <section key={title} className="rounded-card border border-line bg-card p-4">
          <h2 className="mb-2 text-[11px] font-semibold tracking-wider text-faint">{title}</h2>
          <dl className="flex flex-col">
            {fields.map(([label, value]) => (
              <div
                key={label}
                className="flex justify-between gap-3 border-b border-line py-1.5 text-[12.5px] last:border-b-0"
              >
                <dt className="shrink-0 text-dim">{label}</dt>
                <dd className="min-w-0 text-right font-mono break-all">{value || '—'}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}

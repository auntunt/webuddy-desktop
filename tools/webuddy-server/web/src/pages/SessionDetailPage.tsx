import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { ApiError, apiFetch } from '../api/client'
import type { SessionDetail } from '../api/session-types'
import { StatusLine } from '../components/QueryStatus'
import { Button } from '../components/ui/Button'
import { ConversationView } from '../session-detail/ConversationView'
import { SessionMetaGrid } from '../session-detail/SessionMetaGrid'

function errorText(error: Error): string {
  // The server answers 404 for sessions outside your scope too, so don't claim which it was.
  return error instanceof ApiError && error.status === 404
    ? '会话不存在，或你没有权限查看'
    : `加载失败：${error.message}`
}

export function SessionDetailPage() {
  const { key = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const session = useQuery({
    queryKey: ['session', key],
    queryFn: () => apiFetch<SessionDetail>(`/api/sessions/${encodeURIComponent(key)}`)
  })
  // 'default' = first page of this tab (opened from a shared link): there is no list to return to.
  const back = () => (location.key === 'default' ? navigate('/') : navigate(-1))
  const s = session.data

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={back}>
          <ArrowLeft size={13} />
          返回列表
        </Button>
        <h1 className="text-base font-semibold tracking-tight">
          {s ? `${s.local_date} · ${s.user_id} · ${s.agent_label || s.agent_id}` : '会话详情'}
        </h1>
      </header>
      {session.error ? (
        <StatusLine tone="bad">{errorText(session.error)}</StatusLine>
      ) : !s ? (
        <StatusLine>加载中…</StatusLine>
      ) : (
        <>
          <SessionMetaGrid session={s} />
          <section className="flex flex-col gap-2">
            <h2 className="text-[11px] font-semibold tracking-wider text-faint">
              会话正文（已脱敏）
            </h2>
            <ConversationView
              key={key}
              conversation={s.conversation}
              truncated={s.conversation_truncated}
              transcriptBody={s.transcript_body}
              transcriptBytes={s.transcript_bytes}
            />
          </section>
        </>
      )}
    </div>
  )
}

import { RefreshCw, Sparkles } from 'lucide-react'
import { analysisRunMessage } from '../analysis/analysis-run-message'
import { useAnalysis, useRunAnalysis } from '../analysis/use-analysis-queries'
import type { Me } from '../api/types'
import { QueryStatus, StatusLine } from '../components/QueryStatus'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { useFacets } from '../overview/use-overview-queries'
import { useDashboardFilters } from '../filters/use-dashboard-filters'
import { formatCount, formatTokens } from '../format/number-format'
import { formatDateTime } from '../format/date-format'
import { MarkdownView } from '../markdown/MarkdownView'
import { PersonPicker } from '../people/PersonPicker'

export function AnalysisPage({ me }: { me: Me }) {
  const { filters, setFilters } = useDashboardFilters()
  // A member only ever sees themself; a stray ?user= from a previous session must not leak through.
  // An admin's own username is rarely in the data, so default to 全组 rather than their empty result.
  const user =
    me.role === 'member'
      ? me.username
      : filters.user || (me.role === 'admin' ? '__all__' : me.username)
  const facets = useFacets()
  const analysis = useAnalysis(user)
  const run = useRunAnalysis(user)

  const data = analysis.data
  const hasContent = Boolean(data && data.content !== null)

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold tracking-tight">分析</h1>
      <Card
        title="AI 工作分析"
        actions={
          <>
            <PersonPicker
              me={me}
              people={facets.data?.people ?? []}
              value={user}
              onChange={(value) => setFilters({ user: value })}
              allowAll
            />
            <Button size="sm" onClick={() => analysis.refetch()}>
              <RefreshCw size={13} />
              刷新
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={run.isPending}
              onClick={() => run.mutate()}
            >
              <Sparkles size={13} />
              立即分析
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {run.isPending && <StatusLine>分析中，可能要几十秒…</StatusLine>}
          {run.isError && <StatusLine tone="bad">{run.error.message}</StatusLine>}
          {run.isSuccess && !run.isPending && (
            <StatusLine>{analysisRunMessage(run.data)}</StatusLine>
          )}
          <QueryStatus
            isPending={analysis.isPending}
            error={analysis.error}
            isEmpty={!hasContent}
            emptyText={
              <>
                还没有分析结果
                <br />
                <span className="text-faint">
                  点「立即分析」跑一次，或等定时任务（每 2 小时，无新数据会自动跳过）
                </span>
              </>
            }
          >
            {data && data.content !== null && (
              <div className="flex flex-col gap-3">
                <p className="text-xs text-dim">
                  {data.model} · {formatDateTime(data.createdAt)} · 覆盖{' '}
                  {formatCount(data.sessionsCovered)} 会话 · {formatTokens(data.inputTokens)}+
                  {formatTokens(data.outputTokens)} tokens
                </p>
                <MarkdownView content={data.content} />
              </div>
            )}
          </QueryStatus>
        </div>
      </Card>
    </div>
  )
}

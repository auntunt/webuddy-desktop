import { useSearchParams } from 'react-router'
import type { Me } from '../api/types'
import { readToken } from '../auth/token-store'
import { QueryStatus } from '../components/QueryStatus'
import { Card } from '../components/ui/Card'
import { toApiQuery, useDashboardFilters } from '../filters/use-dashboard-filters'
import { toLocalIsoDate } from '../format/date-format'
import { formatCount } from '../format/number-format'
import { shortPath } from '../format/path-format'
import { DailyChart } from '../overview/DailyChart'
import { FilterBar } from '../overview/FilterBar'
import { KpiRow } from '../overview/KpiRow'
import { RankingCard } from '../overview/RankingCard'
import { SessionsTable } from '../overview/SessionsTable'
import {
  SESSIONS_PAGE_SIZE,
  useFacets,
  useGroups,
  useInsights,
  useSessionsPage,
  useStats
} from '../overview/use-overview-queries'

export function OverviewPage({ me }: { me: Me }) {
  const { filters, setFilters } = useDashboardFilters()
  const [params, setParams] = useSearchParams()
  const apiQuery = toApiQuery(filters)
  const offset = Math.max(0, Number(params.get('offset')) || 0)
  const showPeople = me.role !== 'member'

  const facets = useFacets()
  const groups = useGroups()
  const insights = useInsights(apiQuery, me.role)
  const byDay = useStats('day', apiQuery)
  const byAgent = useStats('agent', apiQuery)
  const byPerson = useStats('person', apiQuery, showPeople)
  const byProject = useStats('project', apiQuery)
  const sessions = useSessionsPage(apiQuery, offset)

  const setOffset = (next: number) =>
    setParams(
      (current) => {
        const updated = new URLSearchParams(current)
        if (next > 0) {
          updated.set('offset', String(next))
        } else {
          updated.delete('offset')
        }
        return updated
      },
      { replace: true }
    )

  // A preset range has an open right edge: fill the chart up to today.
  const chartEnd = apiQuery.to ?? (apiQuery.from ? toLocalIsoDate(new Date()) : undefined)
  const total = sessions.data?.total ?? 0

  return (
    <div className="flex flex-col gap-4">
      <h1 className="sr-only">总览</h1>
      <FilterBar
        me={me}
        token={readToken()}
        filters={filters}
        apiQuery={apiQuery}
        setFilters={setFilters}
        facets={facets.data}
        groups={groups.data?.groups ?? []}
      />
      <KpiRow
        overall={insights.data?.overall}
        isPending={insights.isPending}
        error={insights.error}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <DailyChart
          groups={byDay.data?.groups}
          isPending={byDay.isPending}
          error={byDay.error}
          start={apiQuery.from}
          end={chartEnd}
          onSelectDay={(day) => setFilters({ from: day, to: day })}
        />
        <RankingCard
          title="按 agent"
          groups={byAgent.data?.groups}
          isPending={byAgent.isPending}
          error={byAgent.error}
          activeKey={filters.agent}
          onSelect={(key) => setFilters({ agent: key })}
        />
        {showPeople && (
          <RankingCard
            title="按人"
            groups={byPerson.data?.groups}
            isPending={byPerson.isPending}
            error={byPerson.error}
            activeKey={filters.user}
            onSelect={(key) => setFilters({ user: key })}
          />
        )}
        <RankingCard
          title="按项目"
          groups={byProject.data?.groups}
          isPending={byProject.isPending}
          error={byProject.error}
          activeKey={filters.project}
          label={shortPath}
          onSelect={(key) => setFilters({ project: key })}
        />
      </div>
      <Card
        title="会话明细 · 点击查看正文"
        actions={<span className="text-xs text-dim">共 {formatCount(total)} 条</span>}
      >
        <QueryStatus
          isPending={sessions.isPending}
          error={sessions.error}
          isEmpty={total === 0}
          emptyText="当前筛选下没有会话"
        >
          <SessionsTable
            items={sessions.data?.items ?? []}
            total={total}
            offset={offset}
            limit={SESSIONS_PAGE_SIZE}
            onOffsetChange={setOffset}
          />
        </QueryStatus>
      </Card>
    </div>
  )
}

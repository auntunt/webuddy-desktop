import { Download, Search, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { buildQueryString } from '../api/client'
import type { FacetsResponse } from '../api/session-types'
import type { Group, Me } from '../api/types'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { cx } from '../components/ui/class-names'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import type { DashboardFilters, FilterPatch, RangeKey } from '../filters/use-dashboard-filters'
import { shortPath } from '../format/path-format'

const RANGE_TABS: { key: RangeKey; label: string }[] = [
  { key: '7', label: '7 天' },
  { key: '30', label: '30 天' },
  { key: '90', label: '90 天' },
  { key: 'all', label: '全部' }
]

const CLEAR_ALL: FilterPatch = {
  user: '',
  agent: '',
  project: '',
  group: '',
  q: '',
  from: '',
  to: '',
  range: ''
}

type FilterBarProps = {
  me: Me
  token: string | null
  filters: DashboardFilters
  apiQuery: Record<string, string>
  setFilters: (patch: FilterPatch) => void
  facets: FacetsResponse | undefined
  groups: Group[]
}

export function FilterBar({
  me,
  token,
  filters,
  apiQuery,
  setFilters,
  facets,
  groups
}: FilterBarProps) {
  const [keyword, setKeyword] = useState(filters.q ?? '')
  useEffect(() => setKeyword(filters.q ?? ''), [filters.q])
  const activeRange = filters.range ?? (filters.from || filters.to ? undefined : 'all')
  // Token in the query only here: a plain download link can't send an Authorization header.
  const exportQuery = buildQueryString({ ...apiQuery, token })

  return (
    <section
      aria-label="筛选"
      className="flex flex-col gap-2.5 rounded-card border border-line bg-card p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        {me.role !== 'member' && (
          <Select
            aria-label="人员"
            placeholder="全部人员"
            value={filters.user ?? ''}
            onChange={(event) => setFilters({ user: event.target.value })}
            options={(facets?.people ?? []).map((p) => ({
              value: p.value,
              label: `${p.value} (${p.n})`
            }))}
          />
        )}
        <Select
          aria-label="agent"
          placeholder="全部 agent"
          value={filters.agent ?? ''}
          onChange={(event) => setFilters({ agent: event.target.value })}
          options={(facets?.agents ?? []).map((a) => ({
            value: a.value,
            label: `${a.value} (${a.n})`
          }))}
        />
        <Select
          aria-label="项目"
          placeholder="全部项目"
          className="max-w-[260px]"
          value={filters.project ?? ''}
          onChange={(event) => setFilters({ project: event.target.value })}
          options={(facets?.projects ?? []).map((p) => ({
            value: p.value,
            label: `${shortPath(p.value)} · ${p.n} 次${p.last_day ? ` · ${p.last_day}` : ''}`
          }))}
        />
        <GroupFilter me={me} groups={groups} value={filters.group} setFilters={setFilters} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-xs text-dim">区间</span>
          <div
            role="group"
            aria-label="区间"
            className="flex gap-0.5 rounded-card border border-line p-0.5"
          >
            {RANGE_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                aria-pressed={activeRange === tab.key}
                onClick={() => setFilters({ range: tab.key })}
                className={cx(
                  'cursor-pointer rounded-control px-2.5 py-0.5 text-xs transition-colors',
                  activeRange === tab.key ? 'bg-raised text-fg' : 'text-dim hover:text-fg'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <Input
            type="date"
            aria-label="起始日期"
            value={filters.from ?? ''}
            max={filters.to}
            onChange={(event) => setFilters({ from: event.target.value })}
          />
          <span className="text-dim">–</span>
          <Input
            type="date"
            aria-label="结束日期"
            value={filters.to ?? ''}
            min={filters.from}
            onChange={(event) => setFilters({ to: event.target.value })}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex min-w-[240px] flex-1 gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            setFilters({ q: keyword.trim() })
          }}
        >
          <Input
            aria-label="关键词"
            placeholder="搜索路径 / 分支 / 正文，回车应用"
            className="flex-1"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <Button type="submit">
            <Search size={13} />
            搜索
          </Button>
        </form>
        <Button variant="ghost" onClick={() => setFilters(CLEAR_ALL)}>
          <X size={13} />
          清空筛选
        </Button>
        <span className="ml-auto flex gap-2">
          <ExportLink href={`/api/export.csv${exportQuery}`} label="导出 CSV" />
          <ExportLink href={`/api/export.json${exportQuery}`} label="导出 JSON" />
        </span>
      </div>
    </section>
  )
}

function ExportLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      download
      className="inline-flex items-center gap-1.5 rounded-control border border-line-strong bg-card px-3 py-1.5 text-[12.5px] text-fg transition-colors hover:border-line-hover hover:bg-hover"
    >
      <Download size={13} />
      {label}
    </a>
  )
}

function GroupFilter({
  me,
  groups,
  value,
  setFilters
}: {
  me: Me
  groups: Group[]
  value: string | undefined
  setFilters: (patch: FilterPatch) => void
}) {
  if (me.role === 'admin' && groups.length > 0) {
    return (
      <Select
        aria-label="小组"
        placeholder="全部小组"
        value={value ?? ''}
        onChange={(event) => setFilters({ group: event.target.value })}
        options={groups.map((g) => ({ value: g.id, label: g.name }))}
      />
    )
  }
  // A lead only ever sees their own group, so there is nothing to choose.
  if (me.role === 'lead' && groups.length === 1) {
    return <Badge>小组：{groups[0].name}</Badge>
  }
  return null
}

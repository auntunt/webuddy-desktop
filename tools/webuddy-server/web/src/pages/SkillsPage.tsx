import { Download, RefreshCw, Sparkles } from 'lucide-react'
import { buildQueryString } from '../api/client'
import type { Me } from '../api/types'
import { readToken } from '../auth/token-store'
import { QueryStatus, StatusLine } from '../components/QueryStatus'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { useDashboardFilters } from '../filters/use-dashboard-filters'
import { formatCount } from '../format/number-format'
import { useFacets } from '../overview/use-overview-queries'
import { PersonPicker } from '../people/PersonPicker'
import { SkillCard } from '../skills/SkillCard'
import { skillsRunMessage } from '../skills/skills-run-message'
import { useExtractSkills, useSkills } from '../skills/use-skills-queries'

export function SkillsPage({ me }: { me: Me }) {
  const { filters, setFilters } = useDashboardFilters()
  // A member only ever sees themself; a stray ?user= from a previous session must not leak through.
  const user = me.role === 'member' ? me.username : filters.user || me.username
  const token = readToken()
  const facets = useFacets()
  const skills = useSkills(user)
  const extract = useExtractSkills(user)

  const items = skills.data?.items ?? []
  const bundleHref = `/api/skills/bundle${buildQueryString({ user, token })}`

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold tracking-tight">Skills</h1>
      <Card
        title="Skill 库"
        actions={
          <>
            <PersonPicker
              me={me}
              people={facets.data?.people ?? []}
              value={user}
              onChange={(value) => setFilters({ user: value })}
            />
            <Button size="sm" onClick={() => skills.refetch()}>
              <RefreshCw size={13} />
              刷新
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={extract.isPending}
              onClick={() => extract.mutate()}
            >
              <Sparkles size={13} />
              立即提炼
            </Button>
            <a
              href={bundleHref}
              download
              className="inline-flex items-center gap-1.5 rounded-control border border-line-strong bg-card px-3 py-1.5 text-[12.5px] text-fg transition-colors hover:border-line-hover hover:bg-hover"
            >
              <Download size={13} />
              下载整包（{formatCount(items.length)}）
            </a>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {extract.isPending && <StatusLine>提炼中，可能要一两分钟…</StatusLine>}
          {extract.isError && <StatusLine tone="bad">{extract.error.message}</StatusLine>}
          {extract.isSuccess && !extract.isPending && (
            <StatusLine>{skillsRunMessage(extract.data)}</StatusLine>
          )}
          <QueryStatus
            isPending={skills.isPending}
            error={skills.error}
            isEmpty={items.length === 0}
            emptyText={
              <>
                还没有提炼结果
                <br />
                <span className="text-faint">
                  点「立即提炼」跑一次；每 6 小时也会自动跑，且只在有新会话时才调模型
                </span>
              </>
            }
          >
            <ul className="grid gap-3 lg:grid-cols-2">
              {items.map((skill) => (
                <SkillCard key={skill.id} skill={skill} token={token} />
              ))}
            </ul>
          </QueryStatus>
        </div>
      </Card>
    </div>
  )
}

import { ChevronDown, ChevronUp, Download } from 'lucide-react'
import { useState } from 'react'
import type { Skill } from '../api/skill-types'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { formatDateTime } from '../format/date-format'
import { formatCount } from '../format/number-format'
import { MarkdownView } from '../markdown/MarkdownView'

export function SkillCard({ skill, token }: { skill: Skill; token: string | null }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <li className="flex flex-col gap-2.5 rounded-card border border-line bg-card p-3.5">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <p className="text-[14px] font-semibold text-fg">{skill.title}</p>
          {skill.summary && <p className="mt-1 text-[12.5px] text-dim">{skill.summary}</p>}
        </div>
        <a
          href={`/api/skills/${skill.id}/download?token=${encodeURIComponent(token ?? '')}`}
          download
          className="inline-flex items-center gap-1.5 rounded-control border border-line-strong bg-card px-2.5 py-1 text-xs text-fg transition-colors hover:border-line-hover hover:bg-hover"
        >
          <Download size={12} />
          下载
        </a>
      </div>
      {skill.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {skill.tags.map((tag) => (
            <Badge key={tag}>{tag}</Badge>
          ))}
        </div>
      )}
      <p className="text-[11.5px] text-faint">
        来自 {formatCount(skill.source_sessions)} 个会话 · {formatDateTime(skill.created_at)} ·{' '}
        {skill.model ?? '—'}
      </p>
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        {expanded ? '收起正文' : '展开正文'}
      </Button>
      {expanded && <MarkdownView content={skill.body} />}
    </li>
  )
}

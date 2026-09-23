import { useState } from 'react'
import { EmptyState } from '../components/ui/EmptyState'
import { Button } from '../components/ui/Button'
import { formatBytes } from '../format/number-format'

/** Rendering a multi-MB <pre> at once freezes the tab for seconds. */
export const TRANSCRIPT_PREVIEW_CHARS = 2_000_000

export function TranscriptView({ body, bytes }: { body: string | null; bytes: number | null }) {
  const [showAll, setShowAll] = useState(false)
  if (!body) {
    return <EmptyState title="这次会话没有正文" hint="采集端可能只上报了元数据" />
  }
  const clipped = !showAll && body.length > TRANSCRIPT_PREVIEW_CHARS
  return (
    <div className="flex flex-col gap-2">
      {clipped && (
        <div className="flex items-center gap-3 rounded-card border border-line bg-card px-3 py-2 text-xs text-dim">
          正文较长（{formatBytes(bytes ?? body.length)}），先显示前 200 万字符。
          <Button size="sm" className="ml-auto" onClick={() => setShowAll(true)}>
            显示全部
          </Button>
        </div>
      )}
      <pre
        data-testid="transcript"
        className="overflow-x-auto rounded-card border border-line bg-bg p-3.5 font-mono text-[11.5px] leading-relaxed break-words whitespace-pre-wrap text-fg-hover"
      >
        {clipped ? body.slice(0, TRANSCRIPT_PREVIEW_CHARS) : body}
      </pre>
    </div>
  )
}

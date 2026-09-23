import type { ReactNode } from 'react'

export function EmptyState({
  title,
  hint,
  action
}: {
  title: string
  hint?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-card border border-dashed border-line px-6 py-10 text-center">
      <p className="text-sm text-fg">{title}</p>
      {hint && <p className="text-xs text-dim">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

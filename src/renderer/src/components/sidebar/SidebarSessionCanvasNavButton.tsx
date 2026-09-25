import React from 'react'
import { Waypoints } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isWebClientLocation } from '@/lib/web-client-location'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'

/** Sidebar entry for the session canvas page; desktop only (its IPC has no web transport). */
export function SidebarSessionCanvasNavButton(): React.JSX.Element | null {
  const openSessionCanvasPage = useAppStore((s) => s.openSessionCanvasPage)
  const active = useAppStore((s) => s.activeView === 'session-canvas')
  if (isWebClientLocation()) {
    return null
  }
  return (
    <button
      type="button"
      onClick={openSessionCanvasPage}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium tracking-tight transition-colors',
        active
          ? 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground'
          : 'text-worktree-sidebar-foreground/60 hover:bg-worktree-sidebar-foreground/8'
      )}
    >
      <Waypoints
        className={cn('size-4 shrink-0', !active && 'text-worktree-sidebar-foreground/30')}
        strokeWidth={active ? 2.25 : 1.75}
      />
      <span className="flex-1">{translate('sessionCanvas.navLabel', '会话画布')}</span>
    </button>
  )
}

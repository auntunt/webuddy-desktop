import React from 'react'
import { Forward, Workflow } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'

export type SessionConnectAction = 'pass-along' | 'supervise'

export type ScreenPoint = { x: number; y: number }

/** Menu shown where an A → B drag is released; `point` null keeps it closed. */
export function ConnectMenu({
  point,
  onPick,
  onClose
}: {
  point: ScreenPoint | null
  onPick: (action: SessionConnectAction) => void
  onClose: () => void
}): React.JSX.Element | null {
  if (!point) {
    return null
  }
  return (
    <DropdownMenu
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        {/* Invisible anchor at the drop point (same pattern as WorktreeContextMenuView). */}
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          className="pointer-events-none fixed size-px opacity-0"
          style={{ left: point.x, top: point.y }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={0} className="w-60">
        <DropdownMenuItem onSelect={() => onPick('pass-along')}>
          <Forward />
          <div className="flex min-w-0 flex-col">
            <span>{translate('sessionCanvas.connect.passAlong', '传话')}</span>
            <span className="text-xs text-muted-foreground">
              {translate('sessionCanvas.connect.passAlongHint', '把 A 的最新结果发给 B')}
            </span>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onPick('supervise')}>
          <Workflow />
          <div className="flex min-w-0 flex-col">
            <span>{translate('sessionCanvas.connect.supervise', '监督')}</span>
            <span className="text-xs text-muted-foreground">
              {translate('sessionCanvas.connect.superviseHint', '让 A 把一个任务派给 B 并跟进')}
            </span>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

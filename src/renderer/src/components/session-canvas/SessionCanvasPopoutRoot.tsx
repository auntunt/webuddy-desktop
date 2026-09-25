import React, { useEffect } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppMenuPaste } from '@/hooks/useAppMenuPaste'
import { useAppMenuSelectionActions } from '@/hooks/useAppMenuSelectionActions'
import { translate } from '@/i18n/i18n'
import RunningTerminalCloseDialog from '../terminal-pane/RunningTerminalCloseDialog'
import SessionCanvasPage from './SessionCanvasPage'
import { revealInMainWindow, SessionCanvasRevealContext } from './session-canvas-reveal'
import { useSessionCanvasPopoutSnapshot } from './use-session-canvas-popout-snapshot'

/** Root of the pop-out canvas window: the same page, fed by the main window's snapshot. */
export default function SessionCanvasPopoutRoot(): React.JSX.Element {
  // Why: this window has no App shell, so nothing else routes Edit-menu paste/copy here.
  useAppMenuPaste()
  useAppMenuSelectionActions()
  const view = useSessionCanvasPopoutSnapshot()
  useEffect(() => {
    document.title = translate('sessionCanvas.title', '会话画布')
  }, [])
  return (
    <SessionCanvasRevealContext.Provider value={revealInMainWindow}>
      <TooltipProvider delayDuration={400}>
        <div className="flex h-screen min-h-0 flex-col">
          {view.ready ? (
            <SessionCanvasPage popout={{ changedFilesByWorktree: view.changedFilesByWorktree }} />
          ) : null}
        </div>
      </TooltipProvider>
      <Toaster closeButton toastOptions={{ className: 'font-sans text-sm' }} />
      {/* Busy-agent close confirmations are raised by the cards in this window. */}
      <RunningTerminalCloseDialog />
    </SessionCanvasRevealContext.Provider>
  )
}

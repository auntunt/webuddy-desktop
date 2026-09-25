import { toast } from 'sonner'
import { useRunningTerminalCloseConfirmStore } from '@/store/running-terminal-close-confirm'

/** Close one session pane (split siblings survive); a busy agent goes through the shared
 *  running-terminal confirmation first. */
export function closeSessionPane(args: {
  paneKey: string
  tabId: string | null
  title: string
  confirm: boolean
}): void {
  const close = (): void => {
    void window.api.sessionCanvas
      .closePane({ paneKey: args.paneKey })
      .then((result) => {
        if (!result.ok) {
          toast.error(result.reason)
        }
      })
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : String(error))
      })
  }
  if (!args.confirm || !args.tabId) {
    close()
    return
  }
  useRunningTerminalCloseConfirmStore.getState().requestRunningTerminalCloseConfirm({
    terminalTabId: args.tabId,
    tabLabel: args.title,
    copyKind: 'agent',
    onConfirm: close
  })
}

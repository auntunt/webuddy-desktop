import { createContext, useContext } from 'react'
import type { DashboardRevealAgentArgs } from '../../../../shared/dashboard-snapshot'
import { revealDashboardAgent } from '../dashboard/reveal-dashboard-agent'

/** Returns false when the terminal could not be revealed here. */
export type SessionCanvasReveal = (args: DashboardRevealAgentArgs) => boolean

/** The pop-out's store holds no tabs, so there reveal is handed to the main window. */
export const SessionCanvasRevealContext = createContext<SessionCanvasReveal>(revealDashboardAgent)

export function useSessionCanvasReveal(): SessionCanvasReveal {
  return useContext(SessionCanvasRevealContext)
}

/** Pop-out reveal: the main window reports its own failure (it is the one that knows). */
export function revealInMainWindow(args: DashboardRevealAgentArgs): boolean {
  void window.api.sessionCanvas.revealAgent(args).catch(() => {})
  return true
}

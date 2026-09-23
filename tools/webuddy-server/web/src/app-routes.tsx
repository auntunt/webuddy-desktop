import type { ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router'
import type { Me, Role } from './api/types'
import { useAuth } from './auth/session'
import { AppShell } from './layout/AppShell'
import { AnalysisPage } from './pages/AnalysisPage'
import { LoginPage } from './pages/LoginPage'
import { OverviewPage } from './pages/OverviewPage'
import { PlaceholderPage } from './pages/PlaceholderPage'
import { SessionDetailPage } from './pages/SessionDetailPage'
import { SkillsPage } from './pages/SkillsPage'

function FullScreenMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-dim">{children}</div>
  )
}

function RequireAuth({ children }: { children: (me: Me) => ReactNode }) {
  const { token, me, isLoadingMe } = useAuth()
  const location = useLocation()
  if (!token) {
    return (
      <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
    )
  }
  if (isLoadingMe) {
    return <FullScreenMessage>加载中…</FullScreenMessage>
  }
  if (!me) {
    return <FullScreenMessage>无法获取当前用户，请刷新重试</FullScreenMessage>
  }
  return children(me)
}

function RequireRole({ me, roles, children }: { me: Me; roles: Role[]; children: ReactNode }) {
  return roles.includes(me.role) ? children : <Navigate to="/" replace />
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            {(me) => (
              <Routes>
                <Route element={<AppShell me={me} />}>
                  <Route index element={<OverviewPage me={me} />} />
                  <Route path="sessions/:key" element={<SessionDetailPage />} />
                  <Route path="analysis" element={<AnalysisPage me={me} />} />
                  <Route path="skills" element={<SkillsPage me={me} />} />
                  <Route
                    path="admin/users"
                    element={
                      <RequireRole me={me} roles={['admin']}>
                        <PlaceholderPage title="用户与小组" />
                      </RequireRole>
                    }
                  />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Routes>
            )}
          </RequireAuth>
        }
      />
    </Routes>
  )
}

import { LogOut } from 'lucide-react'
import { Suspense } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import type { Me, Role } from '../api/types'
import { useAuth } from '../auth/session'
import { StatusLine } from '../components/QueryStatus'
import { Button } from '../components/ui/Button'
import { cx } from '../components/ui/class-names'

type NavItem = {
  to: string
  label: string
  roles?: Role[]
}

const NAV: NavItem[] = [
  { to: '/', label: '总览' },
  { to: '/analysis', label: '分析' },
  { to: '/skills', label: 'Skills' },
  { to: '/admin/users', label: '用户与小组', roles: ['admin'] }
]

export const ROLE_LABELS: Record<Role, string> = { admin: '管理员', lead: '组长', member: '成员' }

export function visibleNav(role: Role): NavItem[] {
  return NAV.filter((item) => !item.roles || item.roles.includes(role))
}

function UserChip({ me }: { me: Me }) {
  const name = me.display_name || me.username
  return (
    <div className="flex items-center gap-2 text-[12.5px] text-dim">
      <span className="grid size-[22px] place-items-center rounded-full border border-line-strong bg-raised text-[10.5px] font-semibold text-fg">
        {name.slice(0, 1).toUpperCase()}
      </span>
      <span className="text-fg">{name}</span>
      <span>
        {ROLE_LABELS[me.role]}
        {me.group_name ? ` · ${me.group_name}` : ''}
      </span>
    </div>
  )
}

export function AppShell({ me }: { me: Me }) {
  const { logout } = useAuth()
  const navigate = useNavigate()
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line bg-topbar backdrop-blur-md">
        <div className="mx-auto flex h-[52px] max-w-[1320px] items-center gap-4 px-5">
          <NavLink to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <i className="inline-block size-[15px] rounded-[3px] bg-fg" />
            Webuddy
          </NavLink>
          <nav aria-label="主导航" className="flex gap-0.5 rounded-card border border-line p-0.5">
            {visibleNav(me.role).map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  cx(
                    'rounded-control px-3 py-1 text-[12.5px] font-medium whitespace-nowrap transition-colors',
                    isActive ? 'bg-raised text-fg' : 'text-dim hover:text-fg'
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <UserChip me={me} />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                logout()
                navigate('/login', { replace: true })
              }}
            >
              <LogOut size={13} />
              退出
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1320px] px-5 pt-5 pb-24">
        <Suspense fallback={<StatusLine>加载中…</StatusLine>}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  )
}

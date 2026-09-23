import { useState } from 'react'
import type { AdminUser } from '../api/admin-types'
import type { Me } from '../api/types'
import { TokensDialog } from '../admin/TokensDialog'
import { UserDialog } from '../admin/UserDialog'
import { UsersTable } from '../admin/UsersTable'
import { GroupsPanel } from '../admin/GroupsPanel'
import { useAdminGroups, useAdminUsers } from '../admin/use-admin-queries'
import { Card } from '../components/ui/Card'

type UserDialogState = { mode: 'create' | 'edit'; user: AdminUser | null }

export function AdminUsersPage({ me }: { me: Me }) {
  const users = useAdminUsers()
  const groups = useAdminGroups()
  const [userDialog, setUserDialog] = useState<UserDialogState | null>(null)
  const [tokensUser, setTokensUser] = useState<AdminUser | null>(null)

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold tracking-tight">用户与小组</h1>
      <Card title="用户">
        <UsersTable
          users={users.data?.users ?? []}
          isPending={users.isPending}
          error={users.error}
          onCreate={() => setUserDialog({ mode: 'create', user: null })}
          onEdit={(user) => setUserDialog({ mode: 'edit', user })}
          onTokens={setTokensUser}
        />
      </Card>
      <GroupsPanel />
      <UserDialog
        open={userDialog !== null}
        mode={userDialog?.mode ?? 'create'}
        user={userDialog?.user ?? null}
        meId={me.id}
        groups={groups.data?.groups ?? []}
        onClose={() => setUserDialog(null)}
      />
      <TokensDialog user={tokensUser} onClose={() => setTokensUser(null)} />
    </div>
  )
}

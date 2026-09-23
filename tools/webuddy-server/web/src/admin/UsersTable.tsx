import { useState } from 'react'
import type { AdminUser } from '../api/admin-types'
import { QueryStatus } from '../components/QueryStatus'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Table, Td, Th, Tr } from '../components/ui/Table'
import { formatDate } from '../format/date-format'
import { formatCount } from '../format/number-format'
import { ROLE_LABELS } from '../layout/AppShell'

type UsersTableProps = {
  users: AdminUser[]
  isPending: boolean
  error: Error | null
  onCreate: () => void
  onEdit: (user: AdminUser) => void
  onTokens: (user: AdminUser) => void
}

function matches(user: AdminUser, query: string): boolean {
  return (
    user.username.toLowerCase().includes(query) ||
    (user.display_name ?? '').toLowerCase().includes(query)
  )
}

export function UsersTable({
  users,
  isPending,
  error,
  onCreate,
  onEdit,
  onTokens
}: UsersTableProps) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const rows = q ? users.filter((user) => matches(user, q)) : users

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Input
          aria-label="筛选用户"
          placeholder="按用户名或姓名筛选"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="max-w-xs"
        />
        <Button size="sm" variant="primary" className="ml-auto" onClick={onCreate}>
          新建用户
        </Button>
      </div>
      <QueryStatus
        isPending={isPending}
        error={error}
        isEmpty={rows.length === 0}
        emptyText={users.length ? '没有匹配的账号' : '还没有账号'}
      >
        <Table>
          <thead>
            <tr>
              <Th>用户名</Th>
              <Th>姓名</Th>
              <Th>角色</Th>
              <Th>小组</Th>
              <Th className="text-right">会话数</Th>
              <Th>最近活跃</Th>
              <Th className="text-right">凭证</Th>
              <Th>状态</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map((user) => (
              <Tr key={user.id}>
                <Td className="font-mono text-dim">{user.username}</Td>
                <Td>{user.display_name || user.username}</Td>
                <Td>{ROLE_LABELS[user.role]}</Td>
                <Td className="text-dim">{user.group_name ?? '无小组'}</Td>
                <Td className="text-right font-mono">{formatCount(user.session_count)}</Td>
                <Td className="text-dim">{formatDate(user.last_active)}</Td>
                <Td className="text-right font-mono">{user.token_count}</Td>
                <Td>
                  <Badge tone={user.disabled ? 'bad' : 'ok'}>
                    {user.disabled ? '已停用' : '正常'}
                  </Badge>
                </Td>
                <Td className="text-right whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => onEdit(user)}>
                    编辑
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onTokens(user)}>
                    凭证
                  </Button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </QueryStatus>
    </div>
  )
}

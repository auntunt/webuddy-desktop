import type { AdminUser } from '../api/admin-types'
import { QueryStatus } from '../components/QueryStatus'
import { Button } from '../components/ui/Button'
import { Dialog } from '../components/ui/Dialog'
import { Table, Td, Th, Tr } from '../components/ui/Table'
import { formatDateTime } from '../format/date-format'
import { tokenDisplayLabel } from './collector-token-label'
import { useRevokeToken, useUserTokens } from './use-admin-queries'

export function TokensDialog({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const tokens = useUserTokens(user?.id ?? null)
  const revoke = useRevokeToken(user?.id ?? '')
  const items = tokens.data?.tokens ?? []

  return (
    <Dialog
      open={user !== null}
      title={`${user?.username ?? ''} 的凭证`}
      onClose={onClose}
      footer={<Button onClick={onClose}>关闭</Button>}
    >
      <p className="mb-3 text-[12.5px] text-dim">
        每台设备一个 token。吊销后那台机器需要重新登录。
      </p>
      <QueryStatus
        isPending={tokens.isPending}
        error={tokens.error}
        isEmpty={items.length === 0}
        emptyText="没有有效凭证"
      >
        <Table>
          <thead>
            <tr>
              <Th>标签</Th>
              <Th>创建</Th>
              <Th>最近使用</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {items.map((token) => (
              <Tr key={token.id}>
                <Td className="font-mono">{tokenDisplayLabel(token.label)}</Td>
                <Td className="font-mono text-dim">{formatDateTime(token.created_at)}</Td>
                <Td className="font-mono text-dim">
                  {token.last_used_at ? formatDateTime(token.last_used_at) : '从未'}
                </Td>
                <Td className="text-right">
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(token.id)}
                  >
                    吊销
                  </Button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </QueryStatus>
      {revoke.isError && <p className="mt-2 text-[12.5px] text-bad">{revoke.error.message}</p>}
    </Dialog>
  )
}

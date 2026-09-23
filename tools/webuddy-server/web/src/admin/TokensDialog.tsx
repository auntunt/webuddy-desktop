import { useState } from 'react'
import type { AdminUser, UserToken } from '../api/admin-types'
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
  // Confirming inline (rather than a second stacked Dialog) avoids the two
  // Escape/keydown listeners racing to close each other.
  const [pendingRevoke, setPendingRevoke] = useState<UserToken | null>(null)

  function close() {
    setPendingRevoke(null)
    onClose()
  }

  return (
    <Dialog
      open={user !== null}
      title={`${user?.username ?? ''} 的凭证`}
      onClose={close}
      footer={
        pendingRevoke ? (
          <>
            <Button variant="ghost" onClick={() => setPendingRevoke(null)}>
              取消
            </Button>
            <Button
              variant="danger"
              disabled={revoke.isPending}
              onClick={() =>
                revoke.mutate(pendingRevoke.id, { onSuccess: () => setPendingRevoke(null) })
              }
            >
              确认吊销
            </Button>
          </>
        ) : (
          <Button onClick={close}>关闭</Button>
        )
      }
    >
      {pendingRevoke ? (
        <div className="flex flex-col gap-2">
          <p className="text-[12.5px] text-dim">
            确定要吊销「{tokenDisplayLabel(pendingRevoke.label)}」吗？吊销后这台设备需要重新登录。
          </p>
          {revoke.isError && <p className="text-[12.5px] text-bad">{revoke.error.message}</p>}
        </div>
      ) : (
        <>
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
                      <Button size="sm" variant="danger" onClick={() => setPendingRevoke(token)}>
                        吊销
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </QueryStatus>
        </>
      )}
    </Dialog>
  )
}

import { useState } from 'react'
import type { AdminGroup } from '../api/admin-types'
import { QueryStatus } from '../components/QueryStatus'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Dialog } from '../components/ui/Dialog'
import { Table, Td, Th, Tr } from '../components/ui/Table'
import { GroupDialog } from './GroupDialog'
import { useAdminGroups, useDeleteGroup } from './use-admin-queries'

type DialogState = { mode: 'create' | 'edit'; group: AdminGroup | null }

export function GroupsPanel() {
  const groups = useAdminGroups()
  const deleteGroup = useDeleteGroup()
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [pendingDelete, setPendingDelete] = useState<AdminGroup | null>(null)
  const items = groups.data?.groups ?? []

  return (
    <Card
      title="小组"
      actions={
        <Button
          size="sm"
          variant="primary"
          onClick={() => setDialog({ mode: 'create', group: null })}
        >
          新建小组
        </Button>
      }
    >
      <QueryStatus
        isPending={groups.isPending}
        error={groups.error}
        isEmpty={items.length === 0}
        emptyText="还没有小组"
      >
        <Table>
          <thead>
            <tr>
              <Th>小组</Th>
              <Th className="text-right">成员数</Th>
              <Th>组长</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {items.map((group) => (
              <Tr key={group.id}>
                <Td>{group.name}</Td>
                <Td className="text-right font-mono">{group.member_count}</Td>
                <Td className="text-dim">
                  {group.lead_usernames.length ? group.lead_usernames.join('、') : '—'}
                </Td>
                <Td className="text-right whitespace-nowrap">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDialog({ mode: 'edit', group })}
                  >
                    改名
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPendingDelete(group)}>
                    删除
                  </Button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </QueryStatus>
      <GroupDialog
        open={dialog !== null}
        mode={dialog?.mode ?? 'create'}
        group={dialog?.group ?? null}
        onClose={() => setDialog(null)}
      />
      <Dialog
        open={pendingDelete !== null}
        title={`删除「${pendingDelete?.name ?? ''}」？`}
        onClose={() => setPendingDelete(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              取消
            </Button>
            <Button
              variant="danger"
              disabled={deleteGroup.isPending}
              onClick={() => {
                if (pendingDelete) {
                  deleteGroup.mutate(pendingDelete.id, { onSuccess: () => setPendingDelete(null) })
                }
              }}
            >
              确认删除
            </Button>
          </>
        }
      >
        <p className="text-[12.5px] text-dim">
          删除小组不会删除组员账号，但组内 {pendingDelete?.member_count ?? 0} 名成员会变为无组。
        </p>
        {deleteGroup.isError && (
          <p className="mt-2 text-[12.5px] text-bad">{deleteGroup.error.message}</p>
        )}
      </Dialog>
    </Card>
  )
}

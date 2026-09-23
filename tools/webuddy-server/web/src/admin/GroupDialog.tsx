import { useEffect, useState } from 'react'
import type { AdminGroup } from '../api/admin-types'
import { StatusLine } from '../components/QueryStatus'
import { Button } from '../components/ui/Button'
import { Dialog } from '../components/ui/Dialog'
import { Input } from '../components/ui/Input'
import { useCreateGroup, useUpdateGroup } from './use-admin-queries'

type GroupDialogProps = {
  open: boolean
  mode: 'create' | 'edit'
  group: AdminGroup | null
  onClose: () => void
}

export function GroupDialog({ open, mode, group, onClose }: GroupDialogProps) {
  const [name, setName] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    setName(mode === 'edit' ? (group?.name ?? '') : '')
    setFormError(null)
  }, [open, mode, group])

  const createGroup = useCreateGroup()
  const updateGroup = useUpdateGroup(group?.id ?? '')
  const mutation = mode === 'create' ? createGroup : updateGroup
  const serverError = mutation.isError ? mutation.error.message : null

  function submit() {
    setFormError(null)
    if (!name.trim()) {
      setFormError('小组名不能为空')
      return
    }
    mutation.mutate(name.trim(), { onSuccess: onClose })
  }

  return (
    <Dialog
      open={open}
      title={mode === 'create' ? '新建小组' : `重命名 ${group?.name ?? ''}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" disabled={mutation.isPending} onClick={submit}>
            {mode === 'create' ? '创建' : '保存'}
          </Button>
        </>
      }
    >
      <label className="flex flex-col gap-1 text-[12.5px] text-dim">
        小组名
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="例如 前端组"
        />
      </label>
      {(formError || serverError) && <StatusLine tone="bad">{formError || serverError}</StatusLine>}
    </Dialog>
  )
}

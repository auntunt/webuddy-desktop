import { useEffect, useId, useState } from 'react'
import type { AdminGroup, AdminUser } from '../api/admin-types'
import type { Role } from '../api/types'
import { StatusLine } from '../components/QueryStatus'
import { Button } from '../components/ui/Button'
import { Dialog } from '../components/ui/Dialog'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { useCreateUser, useUpdateUser } from './use-admin-queries'

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'member', label: '成员（只能看自己）' },
  { value: 'lead', label: '组长（可看本组）' },
  { value: 'admin', label: '管理员（可看全量、管账号）' }
]

type UserDialogProps = {
  open: boolean
  mode: 'create' | 'edit'
  user: AdminUser | null
  meId: string
  groups: AdminGroup[]
  onClose: () => void
}

function groupOptions(groups: AdminGroup[]) {
  return [{ value: '', label: '无小组' }, ...groups.map((g) => ({ value: g.id, label: g.name }))]
}

export function UserDialog({ open, mode, user, meId, groups, onClose }: UserDialogProps) {
  const nameId = useId()
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('member')
  const [groupId, setGroupId] = useState('')
  const [disabled, setDisabled] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    setUsername(mode === 'edit' ? (user?.username ?? '') : '')
    setDisplayName(mode === 'edit' ? (user?.display_name ?? '') : '')
    setPassword('')
    setRole(mode === 'edit' ? (user?.role ?? 'member') : 'member')
    setGroupId(mode === 'edit' ? (user?.group_id ?? '') : '')
    setDisabled(mode === 'edit' ? Boolean(user?.disabled) : false)
    setFormError(null)
  }, [open, mode, user])

  const createUser = useCreateUser()
  const updateUser = useUpdateUser(user?.id ?? '')
  const mutation = mode === 'create' ? createUser : updateUser
  const isSelf = mode === 'edit' && user?.id === meId

  function submit() {
    setFormError(null)
    if (mode === 'create' && !username.trim()) {
      setFormError('用户名不能为空')
      return
    }
    if (mode === 'create' && password.length < 8) {
      setFormError('初始密码至少 8 位')
      return
    }
    if (mode === 'edit' && password && password.length < 8) {
      setFormError('密码至少 8 位（留空则不改）')
      return
    }
    if (mode === 'create') {
      createUser.mutate(
        {
          username: username.trim(),
          password,
          displayName: displayName.trim() || username.trim(),
          role,
          groupId: groupId || null
        },
        { onSuccess: onClose }
      )
      return
    }
    updateUser.mutate(
      {
        displayName: displayName.trim(),
        role,
        groupId: groupId || null,
        disabled,
        ...(password ? { password } : {})
      },
      { onSuccess: onClose }
    )
  }

  const serverError = mutation.isError ? mutation.error.message : null

  return (
    <Dialog
      open={open}
      title={mode === 'create' ? '新建用户' : `编辑 ${user?.display_name || user?.username || ''}`}
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
      <div className="flex flex-col gap-3">
        {mode === 'create' ? (
          <label className="flex flex-col gap-1 text-[12.5px] text-dim">
            用户名（要和该同事机器上的登录名一致）
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="例如 liyibin"
            />
          </label>
        ) : (
          <p className="text-[12.5px] text-dim">
            用户名 <code className="font-mono text-fg">{user?.username}</code> 不可改 ——
            会话记录按它归属。
          </p>
        )}
        <label className="flex flex-col gap-1 text-[12.5px] text-dim" htmlFor={nameId}>
          显示名
          <Input id={nameId} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[12.5px] text-dim">
          {mode === 'create'
            ? '初始密码（至少 8 位）'
            : '重置密码（留空则不改；改后会吊销该用户所有凭证）'}
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="至少 8 位"
          />
        </label>
        <label className="flex flex-col gap-1 text-[12.5px] text-dim">
          角色
          <Select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            options={ROLE_OPTIONS}
          />
        </label>
        <label className="flex flex-col gap-1 text-[12.5px] text-dim">
          小组
          <Select
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            options={groupOptions(groups)}
          />
        </label>
        {mode === 'edit' && (
          <label className="flex flex-col gap-1 text-[12.5px] text-dim">
            状态
            <Select
              value={disabled ? 'true' : 'false'}
              disabled={isSelf}
              onChange={(e) => setDisabled(e.target.value === 'true')}
              options={[
                { value: 'false', label: '正常' },
                { value: 'true', label: '停用（立即无法上传和登录）' }
              ]}
            />
            {isSelf && <span className="text-faint">不能停用自己</span>}
          </label>
        )}
        {(formError || serverError) && (
          <StatusLine tone="bad">{formError || serverError}</StatusLine>
        )}
      </div>
    </Dialog>
  )
}

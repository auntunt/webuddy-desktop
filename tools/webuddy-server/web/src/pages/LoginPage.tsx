import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/session'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'

function redirectTarget(state: unknown): string {
  if (state && typeof state === 'object' && 'from' in state && typeof state.from === 'string') {
    return state.from.startsWith('/login') ? '/' : state.from
  }
  return '/'
}

export function LoginPage() {
  const { token, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const target = redirectTarget(location.state)

  if (token) {
    return <Navigate to={target} replace />
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await login(username.trim(), password)
      navigate(target, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败，请检查网络后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form
        onSubmit={onSubmit}
        className="flex w-full max-w-xs flex-col gap-3 rounded-card border border-line bg-card p-6"
      >
        <div className="mb-2 flex items-center gap-2 font-semibold">
          <i className="inline-block size-4 rounded-sm bg-fg" />
          Webuddy
        </div>
        <label className="flex flex-col gap-1 text-xs text-dim">
          用户名
          <Input
            autoFocus
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-dim">
          密码
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="text-xs text-bad">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={submitting || !username || !password}>
          {submitting ? '登录中…' : '登录'}
        </Button>
      </form>
    </main>
  )
}

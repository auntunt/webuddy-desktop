import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { hasCustomTitleBar } from '@/app-shell/app-window-chrome'
import { WindowControls } from '@/app-shell/WindowControls'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import {
  orcaProfileSignInResultError,
  orcaProfileSignInThrownError
} from '../orca-profiles/orca-profile-sign-in-error'

export function WebuddyLoginScreen({ onSignedIn }: { onSignedIn: () => void }): React.JSX.Element {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const signIn = useAppStore((state) => state.signInCurrentOrcaProfile)

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (submitting || !username || !password) {
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const result = await signIn({ username, password })
      const resultError = orcaProfileSignInResultError(result)
      if (resultError) {
        setError(resultError)
        setSubmitting(false)
        return
      }
      onSignedIn()
    } catch (thrown) {
      setError(orcaProfileSignInThrownError(thrown))
      setSubmitting(false)
    }
  }

  return (
    <div className="relative flex h-screen w-screen items-center justify-center bg-background text-foreground">
      {/* Why: the native title bar is hidden, so this strip is the only way to move the window. */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-9 [-webkit-app-region:drag]" />
      <form
        className="w-full max-w-sm space-y-5 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm"
        onSubmit={submit}
      >
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold">
            {translate('webuddyAuth.title', '登录 Webuddy')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {translate(
              'webuddyAuth.description',
              '使用公司账号登录。登录后会自动上报本机 AI coding 使用记录。'
            )}
          </p>
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="webuddy-gate-username">
              {translate('webuddyAuth.usernameLabel', '用户名')}
            </Label>
            <Input
              id="webuddy-gate-username"
              name="username"
              autoComplete="username"
              autoFocus
              value={username}
              disabled={submitting}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="webuddy-gate-password">
              {translate('webuddyAuth.passwordLabel', '密码')}
            </Label>
            <Input
              id="webuddy-gate-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              disabled={submitting}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={submitting || !username || !password}>
          {submitting
            ? translate('webuddyAuth.signingIn', '登录中…')
            : translate('webuddyAuth.signIn', '登录')}
        </Button>
      </form>
      {/* Why: drag-region hit-testing is DOM-order-based; render last so the controls stay clickable. */}
      {hasCustomTitleBar ? <WindowControls /> : null}
    </div>
  )
}

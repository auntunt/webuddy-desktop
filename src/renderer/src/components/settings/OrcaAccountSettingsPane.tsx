import { useState } from 'react'
import { BookOpen, Check, CircleUserRound, Files, Smartphone } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useOrcaProfileAuthStatusRefresh } from '@/hooks/use-orca-profile-auth-status-refresh'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { OrcaProfileSignOutConfirmDialog } from '../orca-profiles/OrcaProfileSignOutConfirmDialog'

function accountStatusCopy(
  state: 'local' | 'unconfigured' | 'connected' | 'reconnect-required' | undefined,
  email: string | undefined
): string {
  if (state === 'connected') {
    return email ?? translate('auto.components.settings.orcaAccount.connected', 'Connected')
  }
  if (state === 'reconnect-required') {
    return translate(
      'auto.components.settings.orcaAccount.reconnectRequired',
      'Your session expired. Sign in again to use cloud features.'
    )
  }
  if (state === 'unconfigured') {
    return translate(
      'auto.components.settings.orcaAccount.unavailable',
      'Webuddy sign-in is unavailable in this build.'
    )
  }
  if (state === 'local') {
    return translate(
      'auto.components.settings.orcaAccount.signedOut',
      'Sign in to extend Webuddy with cloud features, including Artifacts and Webuddy Relay.'
    )
  }
  return translate('auto.components.settings.orcaAccount.checking', 'Checking account status…')
}

function AccountBenefit({
  icon: Icon,
  title,
  description,
  className
}: {
  icon: typeof Files
  title: string
  description: string
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

export function OrcaAccountSettingsPane(): React.JSX.Element {
  const authStatus = useAppStore((state) => state.orcaProfileAuthStatus)
  const signIn = useAppStore((state) => state.signInCurrentOrcaProfile)
  const signOut = useAppStore((state) => state.signOutCurrentOrcaProfile)
  const [signOutOpen, setSignOutOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [signInError, setSignInError] = useState<string | null>(null)
  const connected = authStatus?.state === 'connected'
  const canConnect = authStatus?.configured === true

  useOrcaProfileAuthStatusRefresh()

  const confirmSignOut = async (): Promise<void> => {
    if (signingOut) {
      return
    }
    setSigningOut(true)
    const result = await signOut()
    setSigningOut(false)
    if (result) {
      setSignOutOpen(false)
    }
  }

  const submitSignIn = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (submitting || !username || !password) {
      return
    }
    setSubmitting(true)
    setSignInError(null)
    try {
      const result = await signIn({ username, password })
      if (result.status === 'failed') {
        setSignInError(result.error)
        return
      }
      if (result.status !== 'connected') {
        setSignInError(
          translate(
            'auto.components.settings.orcaAccount.signInFailed',
            'Sign-in did not complete. Try again.'
          )
        )
        return
      }
      // Why 成功才清密码：失败时保留输入，用户好改一个字符而不是整段重打。
      setPassword('')
    } catch (error) {
      setSignInError(error instanceof Error ? error.message : String(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <CircleUserRound className="size-5" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">
                {authStatus?.cloud?.displayName?.trim() ||
                  translate('auto.components.settings.orcaAccount.account', 'Webuddy account')}
              </p>
              {connected ? (
                <Badge variant="outline" className="text-[11px] text-muted-foreground">
                  <Check />
                  {translate('auto.components.settings.orcaAccount.connected', 'Connected')}
                </Badge>
              ) : null}
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {accountStatusCopy(authStatus?.state, authStatus?.cloud?.email)}
            </p>
          </div>
          {connected ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={signingOut}
              onClick={() => setSignOutOpen(true)}
            >
              {translate('auto.components.settings.orcaAccount.signOut', 'Sign out')}
            </Button>
          ) : null}
        </div>

        {!connected && canConnect ? (
          <form className="space-y-3 border-t border-border/60 pt-5" onSubmit={submitSignIn}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="webuddy-signin-username">
                  {translate('auto.components.settings.orcaAccount.usernameLabel', 'Username')}
                </Label>
                <Input
                  id="webuddy-signin-username"
                  name="username"
                  autoComplete="username"
                  value={username}
                  disabled={submitting}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="webuddy-signin-password">
                  {translate('auto.components.settings.orcaAccount.passwordLabel', 'Password')}
                </Label>
                <Input
                  id="webuddy-signin-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  disabled={submitting}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
            </div>
            {signInError ? <p className="text-xs text-destructive">{signInError}</p> : null}
            <Button type="submit" size="sm" disabled={submitting || !username || !password}>
              {submitting
                ? translate('auto.components.settings.orcaAccount.signingIn', 'Signing in…')
                : authStatus?.state === 'reconnect-required'
                  ? translate('auto.components.settings.orcaAccount.signInAgain', 'Sign in again')
                  : translate('auto.components.settings.orcaAccount.signIn', 'Sign in to Webuddy')}
            </Button>
          </form>
        ) : null}

        <div className="space-y-4 border-t border-border/60 pt-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
            {translate(
              'auto.components.settings.orcaAccount.benefitsTitle',
              'Included with your account'
            )}
          </p>
          <div className="space-y-5">
            <div className="grid gap-5 md:grid-cols-2 md:gap-0 md:divide-x md:divide-border/60">
              <AccountBenefit
                icon={Files}
                className="md:pr-6"
                title={translate(
                  'auto.components.settings.orcaAccount.artifactsTitle',
                  'Artifact sharing'
                )}
                description={translate(
                  'auto.components.settings.orcaAccount.artifactsDescription',
                  'Publish HTML and Markdown files, then manage every shared link from Webuddy.'
                )}
              />
              <AccountBenefit
                icon={Smartphone}
                className="md:pl-6"
                title={translate(
                  'auto.components.settings.orcaAccount.relayTitle',
                  'Webuddy Relay'
                )}
                description={translate(
                  'auto.components.settings.orcaAccount.relayDescription',
                  'Connect Webuddy Mobile to this desktop across cellular or any Wi-Fi.'
                )}
              />
            </div>
            {/* Why: a third column would squeeze all three; a full-width row
                below keeps the pair's divider and reads as one list. */}
            <AccountBenefit
              icon={BookOpen}
              className="border-t border-border/60 pt-5"
              title={translate('auto.components.settings.orcaAccount.skillsTitle', 'Skill sharing')}
              description={translate(
                'auto.components.settings.orcaAccount.skillsDescription',
                'Share one skill or a whole set behind an unlisted link, and install them on any machine you use.'
              )}
            />
          </div>
        </div>
      </div>

      <OrcaProfileSignOutConfirmDialog
        open={signOutOpen}
        onOpenChange={setSignOutOpen}
        onConfirm={() => void confirmSignOut()}
        signingOut={signingOut}
      />
    </>
  )
}

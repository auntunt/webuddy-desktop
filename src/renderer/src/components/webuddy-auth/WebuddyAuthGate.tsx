import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import type { OrcaProfileAuthStatus } from '../../../../shared/orca-profiles'
import { WebuddyLoginScreen } from './WebuddyLoginScreen'

type GateStatus = 'loading' | 'locked' | 'open'

function gateStatusFor(auth: OrcaProfileAuthStatus): GateStatus {
  if (auth.state === 'connected') {
    return 'open'
  }
  if (auth.state === 'unconfigured') {
    // Why: dev builds without ORCA_CLOUD_API_URL have no sign-in endpoint; locking would brick them.
    console.warn('[webuddy] 未配置登录服务，跳过登录闸门')
    return 'open'
  }
  return 'locked'
}

function reloadRenderer(): void {
  window.location.reload()
}

/** Keeps the workspace unmounted until the company account is signed in. */
export function WebuddyAuthGate({
  children,
  reload = reloadRenderer
}: {
  children: React.ReactNode
  /** Test seam for the open → locked reload. */
  reload?: () => void
}): React.JSX.Element {
  const [status, setStatus] = useState<GateStatus>('loading')
  const statusRef = useRef<GateStatus>('loading')
  const checkSeq = useRef(0)
  const storeAuthState = useAppStore((state) => state.orcaProfileAuthStatus?.state)

  const applyStatus = useCallback(
    (next: GateStatus): void => {
      if (statusRef.current === 'open' && next === 'locked') {
        // Why: App's boot chain is one-shot and its beforeunload persists the session, so never
        // unmount it; reload instead and let the cold start land on the login screen.
        reload()
        return
      }
      statusRef.current = next
      setStatus(next)
    },
    [reload]
  )

  const recheck = useCallback(async (): Promise<void> => {
    const seq = ++checkSeq.current
    try {
      const auth = await window.api.orcaProfiles.authStatus()
      if (seq === checkSeq.current) {
        applyStatus(gateStatusFor(auth))
      }
    } catch (error) {
      console.error('[webuddy] 读取登录状态失败:', error)
      // Why: a transient IPC failure is not a sign-out; only an unopened gate falls back to locked.
      if (seq === checkSeq.current && statusRef.current === 'loading') {
        applyStatus('locked')
      }
    }
  }, [applyStatus])

  useEffect(() => {
    void recheck()
    return window.api.orcaProfiles.onAuthStatusChanged(() => void recheck())
  }, [recheck])

  // Why: renderer-initiated sign-out only updates the store (main broadcasts revocations only),
  // so a store drop to signed-out triggers a re-read of main's truth.
  useEffect(() => {
    if (storeAuthState === 'local' || storeAuthState === 'reconnect-required') {
      void recheck()
    }
  }, [storeAuthState, recheck])

  const handleSignedIn = useCallback(() => {
    checkSeq.current += 1
    applyStatus('open')
  }, [applyStatus])

  if (status === 'loading') {
    return <div className="h-screen w-screen bg-background" />
  }
  if (status === 'locked') {
    return <WebuddyLoginScreen onSignedIn={handleSignedIn} />
  }
  return <>{children}</>
}

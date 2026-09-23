// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authStatus: vi.fn(),
  signIn: vi.fn(),
  authListeners: new Set<() => void>()
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

vi.mock('@/store', async () => {
  const { create } = await import('zustand')
  return {
    useAppStore: create<{ orcaProfileAuthStatus: { state: string } | null }>(() => ({
      orcaProfileAuthStatus: null
    }))
  }
})

vi.mock('@/app-shell/app-window-chrome', () => ({
  hasCustomTitleBar: false
}))

import { useAppStore } from '@/store'
import type { OrcaProfileAuthState, OrcaProfileAuthStatus } from '../../../../shared/orca-profiles'
import { WebuddyAuthGate } from './WebuddyAuthGate'

function auth(state: OrcaProfileAuthState): OrcaProfileAuthStatus {
  return {
    activeProfileId: 'p1',
    configured: state !== 'unconfigured',
    state,
    persistence: 'encrypted'
  }
}

function renderGate(): void {
  render(
    <WebuddyAuthGate>
      <div>workspace</div>
    </WebuddyAuthGate>
  )
}

async function submitCredentials(): Promise<void> {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('用户名'), 'nina')
  await user.type(screen.getByLabelText('密码'), 'correct-horse')
  await user.click(screen.getByRole('button', { name: '登录' }))
}

describe('WebuddyAuthGate', () => {
  beforeEach(() => {
    mocks.authStatus.mockReset()
    mocks.signIn.mockReset()
    mocks.authListeners.clear()
    useAppStore.setState({ orcaProfileAuthStatus: null })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        orcaProfiles: {
          authStatus: mocks.authStatus,
          signIn: mocks.signIn,
          onAuthStatusChanged: (cb: () => void) => {
            mocks.authListeners.add(cb)
            return () => mocks.authListeners.delete(cb)
          }
        }
      }
    })
  })

  afterEach(cleanup)

  it('shows the login screen instead of the workspace when signed out', async () => {
    mocks.authStatus.mockResolvedValue(auth('local'))
    renderGate()

    expect(await screen.findByText('登录 Webuddy')).toBeInTheDocument()
    expect(screen.queryByText('workspace')).not.toBeInTheDocument()
  })

  it('opens the workspace after a successful sign-in', async () => {
    mocks.authStatus.mockResolvedValue(auth('local'))
    mocks.signIn.mockResolvedValue({ status: 'connected', auth: auth('connected') })
    renderGate()

    await submitCredentials()

    expect(mocks.signIn).toHaveBeenCalledWith({ username: 'nina', password: 'correct-horse' })
    expect(await screen.findByText('workspace')).toBeInTheDocument()
  })

  it('stays on the login screen and shows why when sign-in fails', async () => {
    mocks.authStatus.mockResolvedValue(auth('local'))
    mocks.signIn.mockResolvedValue({
      status: 'failed',
      auth: auth('local'),
      error: '用户名或密码不对'
    })
    renderGate()

    await submitCredentials()

    expect(await screen.findByText('用户名或密码不对')).toBeInTheDocument()
    expect(screen.queryByText('workspace')).not.toBeInTheDocument()
  })

  it('returns to the login screen when main reports the session was revoked', async () => {
    mocks.authStatus.mockResolvedValue(auth('connected'))
    renderGate()
    expect(await screen.findByText('workspace')).toBeInTheDocument()

    mocks.authStatus.mockResolvedValue(auth('reconnect-required'))
    await act(async () => {
      for (const listener of mocks.authListeners) {
        listener()
      }
    })

    expect(await screen.findByText('登录 Webuddy')).toBeInTheDocument()
    expect(screen.queryByText('workspace')).not.toBeInTheDocument()
  })

  it('returns to the login screen after a sign-out from settings', async () => {
    mocks.authStatus.mockResolvedValue(auth('connected'))
    renderGate()
    expect(await screen.findByText('workspace')).toBeInTheDocument()

    mocks.authStatus.mockResolvedValue(auth('local'))
    act(() => {
      useAppStore.setState({ orcaProfileAuthStatus: auth('local') })
    })

    expect(await screen.findByText('登录 Webuddy')).toBeInTheDocument()
  })

  it('lets the workspace through when this build has no sign-in endpoint', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.authStatus.mockResolvedValue(auth('unconfigured'))
    renderGate()

    expect(await screen.findByText('workspace')).toBeInTheDocument()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

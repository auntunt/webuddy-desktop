// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type MockAuthStatus = {
  configured: boolean
  state: string
  cloud?: { displayName: string; email: string }
} | null

const mocks = vi.hoisted(() => {
  const state: { orcaProfileAuthStatus: MockAuthStatus } = {
    orcaProfileAuthStatus: {
      configured: true,
      state: 'connected',
      cloud: { displayName: 'Ada Lovelace', email: 'ada@example.com' }
    }
  }
  return {
    signIn: vi.fn(),
    fetchAuthStatus: vi.fn(),
    signOut: vi.fn(),
    state
  }
})

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      ...mocks.state,
      signInCurrentOrcaProfile: mocks.signIn,
      fetchOrcaProfileAuthStatus: mocks.fetchAuthStatus,
      signOutCurrentOrcaProfile: mocks.signOut
    })
}))

vi.mock('../orca-profiles/OrcaProfileSignOutConfirmDialog', () => ({
  OrcaProfileSignOutConfirmDialog: ({
    open,
    onConfirm
  }: {
    open: boolean
    onConfirm: () => void
    children?: ReactNode
  }) => (open ? <button onClick={onConfirm}>Confirm sign out</button> : null)
}))

import { OrcaAccountSettingsPane } from './OrcaAccountSettingsPane'

async function submitCredentials(username: string, password: string): Promise<void> {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Username'), username)
  await user.type(screen.getByLabelText('Password'), password)
  await user.click(screen.getByRole('button', { name: 'Sign in to Webuddy' }))
}

describe('OrcaAccountSettingsPane', () => {
  beforeEach(() => {
    mocks.signIn.mockReset()
    mocks.fetchAuthStatus.mockReset()
    mocks.signOut.mockReset()
    mocks.signOut.mockResolvedValue({ status: 'signed-out' })
    mocks.state.orcaProfileAuthStatus = {
      configured: true,
      state: 'connected',
      cloud: { displayName: 'Ada Lovelace', email: 'ada@example.com' }
    }
  })

  afterEach(cleanup)

  it('shows the connected identity and confirms sign out', async () => {
    const user = userEvent.setup()
    render(<OrcaAccountSettingsPane />)

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('ada@example.com')).toBeInTheDocument()
    expect(screen.getByText('Artifact sharing')).toBeInTheDocument()
    expect(screen.getByText('Webuddy Relay')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await user.click(screen.getByRole('button', { name: 'Confirm sign out' }))
    expect(mocks.signOut).toHaveBeenCalledOnce()
  })

  it('signs in with the entered credentials', async () => {
    mocks.state.orcaProfileAuthStatus = { configured: true, state: 'local' }
    mocks.signIn.mockResolvedValue({ status: 'connected', auth: { state: 'connected' } })
    render(<OrcaAccountSettingsPane />)

    expect(
      screen.getByText(
        'Sign in to extend Webuddy with cloud features, including Artifacts and Webuddy Relay.'
      )
    ).toBeInTheDocument()

    await submitCredentials('nina', 'correct-horse')

    expect(mocks.signIn).toHaveBeenCalledWith({ username: 'nina', password: 'correct-horse' })
  })

  it('keeps the form interactive after a rejected sign-in and shows why', async () => {
    mocks.state.orcaProfileAuthStatus = { configured: true, state: 'local' }
    mocks.signIn.mockResolvedValue({
      status: 'failed',
      auth: { state: 'local' },
      error: '用户名或密码不对'
    })
    render(<OrcaAccountSettingsPane />)

    await submitCredentials('nina', 'wrong')

    expect(await screen.findByText('用户名或密码不对')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in to Webuddy' })).toBeEnabled()
  })

  it('hides the form when this build has no sign-in endpoint', () => {
    mocks.state.orcaProfileAuthStatus = { configured: false, state: 'unconfigured' }
    render(<OrcaAccountSettingsPane />)

    expect(screen.getByText('Webuddy sign-in is unavailable in this build.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument()
  })

  it('loads account status when it is not hydrated yet', () => {
    mocks.state.orcaProfileAuthStatus = null
    render(<OrcaAccountSettingsPane />)

    expect(mocks.fetchAuthStatus).toHaveBeenCalledOnce()
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument()
  })
})

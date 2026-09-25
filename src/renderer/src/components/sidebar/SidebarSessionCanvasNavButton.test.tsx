// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = { activeView: 'terminal', openSessionCanvasPage: vi.fn() }
vi.mock('@/store', () => ({
  useAppStore: (selector: (s: typeof state) => unknown) => selector(state)
}))

import { SidebarSessionCanvasNavButton } from './SidebarSessionCanvasNavButton'

afterEach(() => {
  cleanup()
  Object.assign(window, { __ORCA_WEB_CLIENT__: false })
})

describe('SidebarSessionCanvasNavButton', () => {
  it('shows the entry in the desktop app', () => {
    render(<SidebarSessionCanvasNavButton />)
    expect(screen.getByRole('button', { name: '会话画布' })).toBeTruthy()
  })

  it('is hidden in the web client, where canvas actions are unavailable', () => {
    Object.assign(window, { __ORCA_WEB_CLIENT__: true })
    render(<SidebarSessionCanvasNavButton />)
    expect(screen.queryByRole('button', { name: '会话画布' })).toBeNull()
  })
})

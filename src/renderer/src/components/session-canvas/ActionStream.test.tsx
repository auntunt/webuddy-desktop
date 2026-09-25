// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentActionHistoryEntry } from '../../../../shared/agent-status-types'
import { ActionStream } from './ActionStream'

const SCROLL_HEIGHT = 500
const CLIENT_HEIGHT = 100
let restore: () => void = () => {}

function action(toolName: string, toolInput: string | null, at: number): AgentActionHistoryEntry {
  return { toolName, toolInput, at }
}

beforeEach(() => {
  const scrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
  const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get: () => SCROLL_HEIGHT
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => CLIENT_HEIGHT
  })
  restore = () => {
    if (scrollHeight) {
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scrollHeight)
    }
    if (clientHeight) {
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeight)
    }
  }
})

afterEach(() => {
  cleanup()
  restore()
})

describe('ActionStream', () => {
  it('renders tool name and short input, newest at the bottom', () => {
    render(
      <ActionStream
        actions={[
          action('Read', 'src/a.ts', 1),
          action('Bash', 'pnpm test', 2),
          action('Edit', null, 3)
        ]}
      />
    )
    const rows = screen.getAllByRole('listitem')
    expect(rows.map((row) => row.textContent)).toEqual(['Readsrc/a.ts', 'Bashpnpm test', 'Edit'])
  })

  it('shows an empty hint when no actions were observed', () => {
    render(<ActionStream actions={[]} />)
    expect(screen.getByText('暂无动作')).toBeTruthy()
  })

  it('sticks to the bottom as actions arrive until the user scrolls up', () => {
    const { rerender } = render(<ActionStream actions={[action('Read', 'a', 1)]} />)
    const list = screen.getByRole('list')
    expect(list.scrollTop).toBe(SCROLL_HEIGHT)

    list.scrollTop = 0
    fireEvent.scroll(list)
    rerender(<ActionStream actions={[action('Read', 'a', 1), action('Bash', 'b', 2)]} />)
    expect(list.scrollTop).toBe(0)

    list.scrollTop = SCROLL_HEIGHT - CLIENT_HEIGHT
    fireEvent.scroll(list)
    rerender(
      <ActionStream
        actions={[action('Read', 'a', 1), action('Bash', 'b', 2), action('Edit', 'c', 3)]}
      />
    )
    expect(list.scrollTop).toBe(SCROLL_HEIGHT)
  })
})

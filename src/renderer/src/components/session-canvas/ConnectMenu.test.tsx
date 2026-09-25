// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConnectMenu } from './ConnectMenu'

afterEach(() => {
  cleanup()
})

function renderMenu(): { onPick: ReturnType<typeof vi.fn>; onClose: ReturnType<typeof vi.fn> } {
  const onPick = vi.fn()
  const onClose = vi.fn()
  render(<ConnectMenu point={{ x: 120, y: 80 }} onPick={onPick} onClose={onClose} />)
  return { onPick, onClose }
}

describe('ConnectMenu', () => {
  it('offers pass-along and supervise at the drop point', () => {
    renderMenu()
    const items = screen.getAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('传话'),
      expect.stringContaining('监督')
    ])
  })

  it('reports the picked action', async () => {
    const { onPick } = renderMenu()
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /监督/ }))
    })
    expect(onPick).toHaveBeenCalledWith('supervise')
  })

  it('closes on Escape', async () => {
    const { onClose, onPick } = renderMenu()
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    })
    expect(onClose).toHaveBeenCalled()
    expect(onPick).not.toHaveBeenCalled()
  })

  it('renders nothing without a drop point', () => {
    render(<ConnectMenu point={null} onPick={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

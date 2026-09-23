import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useParams } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { SessionListItem } from '../api/session-types'
import { sessionRow } from './session-row-fixture'
import { SessionsTable } from './SessionsTable'

function DetailProbe() {
  return <p>detail:{useParams().key}</p>
}

function renderTable(items: SessionListItem[], onOffsetChange = vi.fn()) {
  render(
    <MemoryRouter initialEntries={['/?agent=codex']}>
      <Routes>
        <Route
          index
          element={
            <SessionsTable
              items={items}
              total={120}
              offset={50}
              limit={50}
              onOffsetChange={onOffsetChange}
            />
          }
        />
        <Route path="sessions/:key" element={<DetailProbe />} />
      </Routes>
    </MemoryRouter>
  )
  return onOffsetChange
}

describe('SessionsTable', () => {
  it('renders one row per session with formatted cells', () => {
    renderTable([sessionRow(), sessionRow({ dedupe_key: 'k2', transcript_truncated: 1 })])
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    const first = within(rows[0])
    expect(first.getByText('2026-09-20')).toBeInTheDocument()
    expect(first.getByText('lina')).toBeInTheDocument()
    expect(first.getByText('Claude Code')).toBeInTheDocument()
    expect(first.getByText('opus')).toBeInTheDocument()
    expect(first.getByText('work/webuddy-desktop')).toHaveAttribute(
      'title',
      '/Users/lina/work/webuddy-desktop'
    )
    expect(first.getByText('1 小时 30 分')).toBeInTheDocument()
    expect(first.getByText('—')).toBeInTheDocument()
    expect(first.getByText('完整')).toBeInTheDocument()
    expect(within(rows[1]).getByText('截断')).toBeInTheDocument()
    expect(screen.getByText(/第 51–100 条，共 120 条/)).toBeInTheDocument()
  })

  it('opens the session detail with the full key when a row is clicked', async () => {
    renderTable([sessionRow()])
    await userEvent.setup().click(screen.getByText('work/webuddy-desktop'))
    expect(
      screen.getByText('detail:dev-1::claude-code::s1::/Users/lina/.claude/projects/x.jsonl')
    ).toBeInTheDocument()
  })

  it('pages through results', async () => {
    const onOffsetChange = renderTable([sessionRow()])
    const ui = userEvent.setup()
    await ui.click(screen.getByRole('button', { name: '上一页' }))
    await ui.click(screen.getByRole('button', { name: '下一页' }))
    expect(onOffsetChange.mock.calls).toEqual([[0], [100]])
  })
})

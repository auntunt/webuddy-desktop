// @vitest-environment happy-dom

import { act, cleanup, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installReactFlowTestDom } from './session-canvas-test-dom'
import { renderSessionCardNode } from './session-card-test-render'
import { NOW, makeExternal } from './session-graph-test-fixtures'
import { ExternalSessionCard } from './ExternalSessionCard'

let restoreDom: () => void = () => {}

beforeEach(() => {
  restoreDom = installReactFlowTestDom()
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
})

afterEach(() => {
  cleanup()
  restoreDom()
  vi.restoreAllMocks()
})

describe('ExternalSessionCard', () => {
  it('shows a read-only summary with the last three preview messages', async () => {
    const session = makeExternal('e1', {
      title: 'Migrate schema',
      updatedAt: new Date(NOW - 2 * 60 * 60_000).toISOString(),
      preview: [
        { role: 'user', text: 'first', timestamp: null },
        { role: 'assistant', text: 'second', timestamp: null },
        { role: 'user', text: 'third', timestamp: null },
        { role: 'assistant', text: 'fourth', timestamp: null }
      ]
    })
    const { container } = renderSessionCardNode(
      { external: ExternalSessionCard },
      { kind: 'external', session, repoLabel: 'tool' }
    )
    await act(async () => {})
    expect(screen.getByText('外部 · 只读')).toBeTruthy()
    expect(screen.getByText('Migrate schema')).toBeTruthy()
    expect(screen.queryByText('first')).toBeNull()
    expect(screen.getByText('second')).toBeTruthy()
    expect(screen.getByText('fourth')).toBeTruthy()
    expect(screen.getByText('Codex · tool · 2h')).toBeTruthy()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(container.querySelectorAll('.react-flow__handle')).toHaveLength(0)
  })

  it('falls back to the cwd folder when the session has no project', async () => {
    renderSessionCardNode(
      { external: ExternalSessionCard },
      { kind: 'external', session: makeExternal('e2', { updatedAt: null }), repoLabel: null }
    )
    await act(async () => {})
    expect(screen.getByText('Codex · tool')).toBeTruthy()
    expect(screen.getByText('暂无预览')).toBeTruthy()
  })
})

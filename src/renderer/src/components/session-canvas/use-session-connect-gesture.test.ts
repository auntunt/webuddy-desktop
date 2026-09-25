// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react'
import type { FinalConnectionState } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { buildSessionGraph } from './session-graph-model'
import { makeEntry, makeExternal, makeInputs } from './session-graph-test-fixtures'
import { useSessionConnectGesture } from './use-session-connect-gesture'

const graph = buildSessionGraph(
  makeInputs({
    liveEntries: [makeEntry('a'), makeEntry('b')],
    externalSessions: [makeExternal('e1', { cwd: null })]
  })
)
// The hook reads only the pointer position; the connection comes from onConnect.
const END_STATE: FinalConnectionState = {
  isValid: null,
  from: null,
  fromHandle: null,
  fromPosition: null,
  fromNode: null,
  to: null,
  toHandle: null,
  toPosition: null,
  toNode: null,
  pointer: null
}

function release(
  result: { current: ReturnType<typeof useSessionConnectGesture> },
  source: string,
  target: string
): void {
  act(() => {
    result.current.onConnect({ source, target, sourceHandle: null, targetHandle: null })
    result.current.onConnectEnd(
      new MouseEvent('pointerup', { clientX: 300, clientY: 200 }),
      END_STATE
    )
  })
}

describe('useSessionConnectGesture', () => {
  it('validates only live → live, non-self connections', () => {
    const { result } = renderHook(() => useSessionConnectGesture(graph))
    const edge = (source: string, target: string) => ({
      source,
      target,
      sourceHandle: null,
      targetHandle: null
    })
    expect(result.current.isValidConnection(edge('live:a', 'live:b'))).toBe(true)
    expect(result.current.isValidConnection(edge('live:a', 'live:a'))).toBe(false)
    expect(result.current.isValidConnection(edge('live:a', 'ext:e1'))).toBe(false)
  })

  it('opens the menu at the release point, then the picked dialog', () => {
    const { result } = renderHook(() => useSessionConnectGesture(graph))
    release(result, 'live:a', 'live:b')
    expect(result.current.request).toMatchObject({ mode: 'menu', point: { x: 300, y: 200 } })
    expect(result.current.request?.connection.from.paneKey).toBe('a')
    expect(result.current.request?.connection.to.paneKey).toBe('b')
    // Radix reports the pick and then its own close; the dialog must survive that close.
    act(() => {
      result.current.pick('pass-along')
      result.current.closeMenu()
    })
    expect(result.current.request?.mode).toBe('pass-along')
    act(() => result.current.close())
    expect(result.current.request).toBeNull()
  })

  it('dismissing the menu clears the request', () => {
    const { result } = renderHook(() => useSessionConnectGesture(graph))
    release(result, 'live:a', 'live:b')
    act(() => result.current.closeMenu())
    expect(result.current.request).toBeNull()
  })

  it('ignores a release that did not connect two live cards', () => {
    const { result } = renderHook(() => useSessionConnectGesture(graph))
    act(() => {
      result.current.onConnectEnd(new MouseEvent('pointerup'), END_STATE)
    })
    expect(result.current.request).toBeNull()
    release(result, 'live:a', 'ext:e1')
    expect(result.current.request).toBeNull()
  })
})

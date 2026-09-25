import { useCallback, useRef, useState } from 'react'
import type { Connection, Edge, OnConnect, OnConnectEnd } from '@xyflow/react'
import type { ScreenPoint, SessionConnectAction } from './ConnectMenu'
import {
  isLiveSessionConnection,
  resolveSessionConnection,
  type ResolvedSessionConnection
} from './session-connect-model'
import type { SessionGraph } from './session-graph-types'

export type SessionConnectRequest = {
  connection: ResolvedSessionConnection
  point: ScreenPoint
  mode: 'menu' | SessionConnectAction
}

function releasePoint(event: MouseEvent | TouchEvent): ScreenPoint {
  if ('changedTouches' in event) {
    const touch = event.changedTouches[0]
    return { x: touch?.clientX ?? 0, y: touch?.clientY ?? 0 }
  }
  return { x: event.clientX, y: event.clientY }
}

/** A → B drag between live cards: a menu at the release point, then one dialog. */
export function useSessionConnectGesture(graph: SessionGraph): {
  request: SessionConnectRequest | null
  isValidConnection: (connection: Connection | Edge) => boolean
  onConnect: OnConnect
  onConnectEnd: OnConnectEnd
  pick: (action: SessionConnectAction) => void
  closeMenu: () => void
  close: () => void
} {
  const [request, setRequest] = useState<SessionConnectRequest | null>(null)
  // Why: onConnect has the normalized ends but no pointer; onConnectEnd fires right after with it.
  const pendingRef = useRef<ResolvedSessionConnection | null>(null)

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => isLiveSessionConnection(connection),
    []
  )
  const onConnect: OnConnect = useCallback(
    (connection) => {
      pendingRef.current = resolveSessionConnection(graph, connection)
    },
    [graph]
  )
  const onConnectEnd: OnConnectEnd = useCallback((event) => {
    const connection = pendingRef.current
    pendingRef.current = null
    if (connection) {
      setRequest({ connection, point: releasePoint(event), mode: 'menu' })
    }
  }, [])
  const pick = useCallback((action: SessionConnectAction) => {
    setRequest((current) => (current ? { ...current, mode: action } : current))
  }, [])
  // Why: Radix closes the menu right after a pick; only a plain dismiss should drop the request.
  const closeMenu = useCallback(() => {
    setRequest((current) => (current?.mode === 'menu' ? null : current))
  }, [])
  const close = useCallback(() => setRequest(null), [])

  return { request, isValidConnection, onConnect, onConnectEnd, pick, closeMenu, close }
}

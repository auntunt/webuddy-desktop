import { useEffect } from 'react'
import { installSessionCanvasPopoutBridge } from './session-canvas-popout-bridge'

/** Main-window relay for the pop-out canvas; idle until a pop-out opens. */
export default function SessionCanvasPopoutBridge(): null {
  useEffect(() => installSessionCanvasPopoutBridge(), [])
  return null
}

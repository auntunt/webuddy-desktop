import type { CanvasPoint } from './session-layout-model'

// Why: card placement is a per-device view preference, not host state (same reasoning as
// linear-issue-view-storage), so it lives in browser storage rather than `ui.set`.
export const SESSION_CANVAS_POSITIONS_KEY = 'sessionCanvas.positions'
// Pane keys churn over time; keep the newest drags and let stale ones fall off.
export const SESSION_CANVAS_POSITIONS_MAX = 500

function isCanvasPoint(value: unknown): value is CanvasPoint {
  return (
    typeof value === 'object' &&
    value !== null &&
    'x' in value &&
    'y' in value &&
    typeof value.x === 'number' &&
    Number.isFinite(value.x) &&
    typeof value.y === 'number' &&
    Number.isFinite(value.y)
  )
}

export function loadSessionCanvasPositions(): Record<string, CanvasPoint> {
  try {
    const raw = localStorage.getItem(SESSION_CANVAS_POSITIONS_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {}
    }
    const positions: Record<string, CanvasPoint> = {}
    for (const [id, point] of Object.entries(parsed)) {
      if (isCanvasPoint(point)) {
        positions[id] = { x: point.x, y: point.y }
      }
    }
    return positions
  } catch {
    return {}
  }
}

/** Moves `nodeId` to the newest slot and trims the oldest entries past the cap. */
export function withSavedPosition(
  positions: Record<string, CanvasPoint>,
  nodeId: string,
  point: CanvasPoint
): Record<string, CanvasPoint> {
  const entries = Object.entries(positions).filter(([id]) => id !== nodeId)
  entries.push([nodeId, point])
  return Object.fromEntries(entries.slice(-SESSION_CANVAS_POSITIONS_MAX))
}

export function saveSessionCanvasPositions(positions: Record<string, CanvasPoint>): void {
  try {
    if (Object.keys(positions).length === 0) {
      localStorage.removeItem(SESSION_CANVAS_POSITIONS_KEY)
      return
    }
    localStorage.setItem(SESSION_CANVAS_POSITIONS_KEY, JSON.stringify(positions))
  } catch {
    // The canvas stays usable when browser storage is unavailable or full.
  }
}

/**
 * Remembered (not user-saved) positions: current frame wins, and nodes filtered out keep
 * their last spot so clearing a search puts them back. Newest frame survives the cap.
 */
export function mergeRememberedPositions(
  previous: Record<string, CanvasPoint>,
  current: Record<string, CanvasPoint>
): Record<string, CanvasPoint> {
  const stale = Object.entries(previous).filter(([id]) => !(id in current))
  const entries = [...stale, ...Object.entries(current)]
  return Object.fromEntries(entries.slice(-SESSION_CANVAS_POSITIONS_MAX))
}

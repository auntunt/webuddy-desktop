export type CanvasPoint = { x: number; y: number }

export const SESSION_CARD_WIDTH = 320
export const SESSION_CARD_HEIGHT = 220
export const SESSION_LAYOUT_GAP = 40
/** Inner padding of a repo group; also leaves room for the group title. */
export const SESSION_GROUP_PADDING = 48
export const SESSION_GROUP_GRID_COLUMNS = 3
// Bounds the free-slot search; a group never realistically holds this many cards.
const MAX_SEARCH_ROWS = 500

const STEP_X = SESSION_CARD_WIDTH + SESSION_LAYOUT_GAP
const STEP_Y = SESSION_CARD_HEIGHT + SESSION_LAYOUT_GAP

function overlapsAny(candidate: CanvasPoint, existing: Iterable<CanvasPoint>): boolean {
  for (const other of existing) {
    if (
      Math.abs(candidate.x - other.x) < SESSION_CARD_WIDTH &&
      Math.abs(candidate.y - other.y) < SESSION_CARD_HEIGHT
    ) {
      return true
    }
  }
  return false
}

/**
 * Next free spot for a new card. `existing` holds the cards already placed in `groupId`,
 * in that group's relative coordinates. A parent outside that map (another group) is
 * ignored because its coordinates are not comparable.
 */
export function autoPlace(args: {
  existing: Map<string, CanvasPoint>
  groupId: string
  parentId?: string
}): CanvasPoint {
  const occupied = [...args.existing.values()]
  const parent = args.parentId ? args.existing.get(args.parentId) : undefined
  if (parent) {
    for (let row = 0; row < MAX_SEARCH_ROWS; row++) {
      const candidate = { x: parent.x + STEP_X, y: parent.y + row * STEP_Y }
      if (!overlapsAny(candidate, occupied)) {
        return candidate
      }
    }
  }
  for (let index = 0; index < MAX_SEARCH_ROWS * SESSION_GROUP_GRID_COLUMNS; index++) {
    const candidate = {
      x: SESSION_GROUP_PADDING + (index % SESSION_GROUP_GRID_COLUMNS) * STEP_X,
      y: SESSION_GROUP_PADDING + Math.floor(index / SESSION_GROUP_GRID_COLUMNS) * STEP_Y
    }
    if (!overlapsAny(candidate, occupied)) {
      return candidate
    }
  }
  return { x: SESSION_GROUP_PADDING, y: SESSION_GROUP_PADDING }
}

/**
 * Group box that encloses its (relative) child cards plus padding. Children dragged above or
 * left of the group origin yield a `childOffset`: the group renders shifted by -offset and the
 * children by +offset, so on-screen positions stay where the user put them.
 */
export function measureGroupSize(children: readonly CanvasPoint[]): {
  width: number
  height: number
  childOffset: CanvasPoint
} {
  let minX = 0
  let minY = 0
  for (const child of children) {
    minX = Math.min(minX, child.x)
    minY = Math.min(minY, child.y)
  }
  const childOffset = {
    x: minX < 0 ? SESSION_GROUP_PADDING - minX : 0,
    y: minY < 0 ? SESSION_GROUP_PADDING - minY : 0
  }
  let maxX = SESSION_GROUP_PADDING
  let maxY = SESSION_GROUP_PADDING
  for (const child of children) {
    maxX = Math.max(maxX, child.x + childOffset.x)
    maxY = Math.max(maxY, child.y + childOffset.y)
  }
  return {
    width: maxX + SESSION_CARD_WIDTH + SESSION_GROUP_PADDING,
    height: maxY + SESSION_CARD_HEIGHT + SESSION_GROUP_PADDING,
    childOffset
  }
}

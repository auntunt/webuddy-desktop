import { describe, expect, it } from 'vitest'
import {
  SESSION_CARD_HEIGHT,
  SESSION_CARD_WIDTH,
  SESSION_GROUP_PADDING,
  SESSION_LAYOUT_GAP,
  autoPlace,
  measureGroupSize
} from './session-layout-model'

const STEP_X = SESSION_CARD_WIDTH + SESSION_LAYOUT_GAP
const STEP_Y = SESSION_CARD_HEIGHT + SESSION_LAYOUT_GAP
const ORIGIN = { x: SESSION_GROUP_PADDING, y: SESSION_GROUP_PADDING }

describe('autoPlace', () => {
  it('uses card size 320x220', () => {
    expect(SESSION_CARD_WIDTH).toBe(320)
    expect(SESSION_CARD_HEIGHT).toBe(220)
  })

  it('places the first card at the group grid origin', () => {
    expect(autoPlace({ existing: new Map(), groupId: 'group:r' })).toEqual(ORIGIN)
  })

  it('fills the next empty grid cell', () => {
    const existing = new Map([['a', ORIGIN]])
    expect(autoPlace({ existing, groupId: 'group:r' })).toEqual({
      x: ORIGIN.x + STEP_X,
      y: ORIGIN.y
    })
  })

  it('wraps to the next row after the grid columns fill', () => {
    const existing = new Map([
      ['a', ORIGIN],
      ['b', { x: ORIGIN.x + STEP_X, y: ORIGIN.y }],
      ['c', { x: ORIGIN.x + 2 * STEP_X, y: ORIGIN.y }]
    ])
    expect(autoPlace({ existing, groupId: 'group:r' })).toEqual({
      x: ORIGIN.x,
      y: ORIGIN.y + STEP_Y
    })
  })

  it('skips cells overlapped by a user-dragged card', () => {
    const existing = new Map([['a', { x: ORIGIN.x + 50, y: ORIGIN.y + 30 }]])
    expect(autoPlace({ existing, groupId: 'group:r' })).toEqual({
      x: ORIGIN.x + 2 * STEP_X,
      y: ORIGIN.y
    })
  })

  it('places a child to the right of its parent', () => {
    const existing = new Map([['p', { x: 500, y: 300 }]])
    expect(autoPlace({ existing, groupId: 'group:r', parentId: 'p' })).toEqual({
      x: 500 + STEP_X,
      y: 300
    })
  })

  it('stacks siblings below when the slot right of the parent is taken', () => {
    const existing = new Map([
      ['p', { x: 0, y: 0 }],
      ['c1', { x: STEP_X, y: 0 }]
    ])
    expect(autoPlace({ existing, groupId: 'group:r', parentId: 'p' })).toEqual({
      x: STEP_X,
      y: STEP_Y
    })
  })

  it('falls back to the grid when the parent is not placed in this group', () => {
    expect(autoPlace({ existing: new Map(), groupId: 'group:r', parentId: 'missing' })).toEqual(
      ORIGIN
    )
  })
})

describe('measureGroupSize', () => {
  it('wraps children with padding', () => {
    expect(measureGroupSize([ORIGIN, { x: ORIGIN.x + STEP_X, y: ORIGIN.y + STEP_Y }])).toEqual({
      width: ORIGIN.x + STEP_X + SESSION_CARD_WIDTH + SESSION_GROUP_PADDING,
      height: ORIGIN.y + STEP_Y + SESSION_CARD_HEIGHT + SESSION_GROUP_PADDING,
      childOffset: { x: 0, y: 0 }
    })
  })

  it('shifts children with negative offsets inside the padded box', () => {
    expect(
      measureGroupSize([
        { x: -100, y: 10 },
        { x: 200, y: -30 }
      ])
    ).toEqual({
      width: 200 + SESSION_GROUP_PADDING + 100 + SESSION_CARD_WIDTH + SESSION_GROUP_PADDING,
      height: 10 + SESSION_GROUP_PADDING + 30 + SESSION_CARD_HEIGHT + SESSION_GROUP_PADDING,
      childOffset: { x: SESSION_GROUP_PADDING + 100, y: SESSION_GROUP_PADDING + 30 }
    })
  })

  it('gives an empty group one card of room', () => {
    expect(measureGroupSize([])).toEqual({
      width: SESSION_CARD_WIDTH + 2 * SESSION_GROUP_PADDING,
      height: SESSION_CARD_HEIGHT + 2 * SESSION_GROUP_PADDING,
      childOffset: { x: 0, y: 0 }
    })
  })
})

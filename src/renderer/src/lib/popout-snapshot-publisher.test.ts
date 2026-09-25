import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installPopoutSnapshotPublisher } from './popout-snapshot-publisher'

function setup(initiallyOpen = false) {
  let openChanged: ((open: boolean) => void) | null = null
  let requested: (() => void) | null = null
  let changed: (() => void) | null = null
  const unwatch = vi.fn()
  const args = {
    throttleMs: 250,
    publish: vi.fn(),
    watch: vi.fn((onChanged: () => void) => {
      changed = onChanged
      return unwatch
    }),
    onPopoutOpenChanged: vi.fn((cb: (open: boolean) => void) => {
      openChanged = cb
      return vi.fn()
    }),
    onSnapshotRequested: vi.fn((cb: () => void) => {
      requested = cb
      return vi.fn()
    }),
    getPopoutOpen: vi.fn(async () => initiallyOpen)
  }
  const dispose = installPopoutSnapshotPublisher(args)
  return {
    args,
    dispose,
    unwatch,
    open: (next: boolean) => openChanged?.(next),
    request: () => requested?.(),
    change: () => changed?.()
  }
}

describe('installPopoutSnapshotPublisher', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('does nothing until the pop-out opens, then publishes a full snapshot', () => {
    const harness = setup()
    harness.request()
    expect(harness.args.publish).not.toHaveBeenCalled()
    expect(harness.args.watch).not.toHaveBeenCalled()

    harness.open(true)
    expect(harness.args.publish).toHaveBeenCalledWith(true)
    expect(harness.args.watch).toHaveBeenCalledOnce()
  })

  it('throttles store changes into a leading and a trailing slim publish', () => {
    const harness = setup()
    harness.open(true)
    harness.args.publish.mockClear()
    vi.advanceTimersByTime(300)

    harness.change()
    expect(harness.args.publish).toHaveBeenCalledWith(false)
    harness.change()
    harness.change()
    expect(harness.args.publish).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(250)
    expect(harness.args.publish).toHaveBeenCalledTimes(2)
    expect(harness.args.publish).toHaveBeenLastCalledWith(false)
  })

  it('answers a snapshot request with a full publish while open', () => {
    const harness = setup()
    harness.open(true)
    harness.args.publish.mockClear()
    harness.request()
    expect(harness.args.publish).toHaveBeenCalledWith(true)
  })

  it('stops watching and drops a pending trailing publish on close', () => {
    const harness = setup()
    harness.open(true)
    harness.change()
    harness.open(false)
    expect(harness.unwatch).toHaveBeenCalledOnce()
    harness.args.publish.mockClear()
    vi.advanceTimersByTime(500)
    harness.change()
    expect(harness.args.publish).not.toHaveBeenCalled()
  })

  it('recovers an already-open pop-out after a main-window reload', async () => {
    const harness = setup(true)
    await vi.waitFor(() => expect(harness.args.publish).toHaveBeenCalledWith(true))
  })

  it('releases everything on dispose', () => {
    const harness = setup()
    harness.open(true)
    harness.dispose()
    expect(harness.unwatch).toHaveBeenCalledOnce()
    const offOpen = harness.args.onPopoutOpenChanged.mock.results[0]!.value
    const offRequested = harness.args.onSnapshotRequested.mock.results[0]!.value
    expect(offOpen).toHaveBeenCalledOnce()
    expect(offRequested).toHaveBeenCalledOnce()
  })
})

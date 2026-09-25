type Unsubscribe = (() => void) | undefined

export type PopoutSnapshotPublisherArgs = {
  throttleMs: number
  /** `full` is forced whenever the pop-out could be starting from nothing (it opened, or it
   *  asked); throttled republishes may omit fields the pop-out already has. */
  publish: (full: boolean) => void
  /** Subscribe to snapshot-relevant writes; only held while the pop-out is open. */
  watch: (onChanged: () => void) => () => void
  onPopoutOpenChanged: (callback: (open: boolean) => void) => Unsubscribe
  onSnapshotRequested: (callback: () => void) => Unsubscribe
  getPopoutOpen: () => Promise<boolean>
}

/**
 * Main-window side of a pop-out relay: publishes while the pop-out is open (free while it
 * is closed), with a leading + trailing throttle so the first change paints immediately
 * and bursts collapse into one trailing publish. Returns a disposer.
 */
export function installPopoutSnapshotPublisher(args: PopoutSnapshotPublisherArgs): () => void {
  let open = false
  let disposed = false
  let unwatch: (() => void) | null = null
  let trailingTimer: ReturnType<typeof setTimeout> | null = null
  let lastPublishAt = 0

  const clearTrailing = (): void => {
    if (trailingTimer) {
      clearTimeout(trailingTimer)
      trailingTimer = null
    }
  }

  const publishNow = (full: boolean): void => {
    lastPublishAt = Date.now()
    args.publish(full)
  }

  const publishThrottled = (): void => {
    if (!open || disposed) {
      return
    }
    const elapsed = Date.now() - lastPublishAt
    if (elapsed >= args.throttleMs) {
      clearTrailing()
      publishNow(false)
      return
    }
    trailingTimer ??= setTimeout(() => {
      trailingTimer = null
      if (open && !disposed) {
        publishNow(false)
      }
    }, args.throttleMs - elapsed)
  }

  const setOpen = (next: boolean): void => {
    if (next === open || disposed) {
      return
    }
    open = next
    if (open) {
      unwatch ??= args.watch(publishThrottled)
      publishNow(true)
      return
    }
    unwatch?.()
    unwatch = null
    clearTrailing()
  }

  const offOpenChanged = args.onPopoutOpenChanged(setOpen)
  // The pop-out asks on mount: its cached snapshot may be stale.
  const offRequested = args.onSnapshotRequested(() => {
    if (open) {
      publishNow(true)
    }
  })
  // Recover the open state when the main window (re)mounts while a pop-out is already
  // open — e.g. after a renderer reload.
  void args
    .getPopoutOpen()
    .then((isOpen) => {
      if (isOpen) {
        setOpen(true)
      }
    })
    .catch(() => {})

  return () => {
    disposed = true
    offOpenChanged?.()
    offRequested?.()
    unwatch?.()
    unwatch = null
    clearTrailing()
  }
}

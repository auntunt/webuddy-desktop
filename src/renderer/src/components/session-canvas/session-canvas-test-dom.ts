// Minimal layout shims so React Flow can measure nodes under happy-dom (no layout engine).

// Big enough that onlyRenderVisibleElements keeps every test node after fitView.
const PANE_SIZE = { width: 4000, height: 3000 }
const CARD_SIZE = { width: 320, height: 220 }

function sizeOf(element: HTMLElement): { width: number; height: number } {
  if (
    element.classList.contains('react-flow') ||
    element.classList.contains('react-flow__renderer') ||
    element.classList.contains('react-flow__pane')
  ) {
    return PANE_SIZE
  }
  // Group nodes carry their size inline; cards fall back to the layout card size.
  return {
    width: Number.parseFloat(element.style.width) || CARD_SIZE.width,
    height: Number.parseFloat(element.style.height) || CARD_SIZE.height
  }
}

class ImmediateResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    // Real observers report once on observe; React Flow measures nodes from that report.
    const entry: ResizeObserverEntry = {
      target,
      contentRect: target.getBoundingClientRect(),
      borderBoxSize: [],
      contentBoxSize: [],
      devicePixelContentBoxSize: []
    }
    queueMicrotask(() => this.callback([entry], this))
  }
  unobserve(): void {}
  disconnect(): void {}
}

export function installReactFlowTestDom(): () => void {
  const originalResizeObserver = globalThis.ResizeObserver
  const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
  const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
  globalThis.ResizeObserver = ImmediateResizeObserver
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return sizeOf(this).width
    }
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return sizeOf(this).height
    }
  })
  return () => {
    globalThis.ResizeObserver = originalResizeObserver
    if (width) {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', width)
    }
    if (height) {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', height)
    }
  }
}

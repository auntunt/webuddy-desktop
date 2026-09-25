import { createPopoutWindowController } from './popout-window-controller'

// Why no partition: card positions live in the main window's localStorage, which only a
// window on the same session can read — so zoom follows the app-wide level here.
export const sessionCanvasPopout = createPopoutWindowController({
  logTag: 'session-canvas-popout',
  title: 'Webuddy Session Canvas',
  openChangedChannel: 'sessionCanvas:popoutOpenChanged',
  boundsKey: 'sessionCanvasPopoutBounds',
  surface: 'session-canvas'
})

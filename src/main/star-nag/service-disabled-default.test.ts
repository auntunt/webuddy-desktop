import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createHarness,
  createIpcHandlerLookup,
  createWindow,
  flushAsyncWork,
  resetStarNagMocks,
  type TestWindow
} from './service-test-harness'

const mocks = vi.hoisted(() => ({
  appMock: { getVersion: vi.fn(() => '1.2.3') },
  browserWindowMock: { getAllWindows: vi.fn<() => TestWindow[]>(() => []) },
  checkOrcaStarredMock: vi.fn(),
  starOrcaMock: vi.fn(),
  trackMock: vi.fn(),
  getCohortAtEmitMock: vi.fn(() => ({ nth_repo_added: 3 })),
  ipcMainHandleMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: mocks.appMock,
  BrowserWindow: mocks.browserWindowMock,
  ipcMain: { handle: mocks.ipcMainHandleMock }
}))
vi.mock('../github/client', () => ({
  checkOrcaStarred: mocks.checkOrcaStarredMock,
  starOrca: mocks.starOrcaMock
}))
vi.mock('../telemetry/client', () => ({ track: mocks.trackMock }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: mocks.getCohortAtEmitMock }))

const getIpcHandler = createIpcHandlerLookup(mocks.ipcMainHandleMock)

describe('StarNagService default (Webuddy)', () => {
  let consoleInfoMock: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    resetStarNagMocks(mocks)
    consoleInfoMock = vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  afterEach(() => {
    consoleInfoMock.mockRestore()
  })

  it('never shows the star prompt unless explicitly enabled', async () => {
    const window = createWindow()
    mocks.browserWindowMock.getAllWindows.mockReturnValue([window])
    mocks.checkOrcaStarredMock.mockResolvedValue(false)
    const { service, emitAgentStarted } = createHarness({}, { enabled: false })

    service.registerIpcHandlers()
    service.start()
    getIpcHandler('star-nag:forceShow')()
    emitAgentStarted(500)
    await flushAsyncWork()

    expect(window.webContents.send).not.toHaveBeenCalledWith('star-nag:show', expect.anything())
  })
})

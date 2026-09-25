import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PASS_ALONG_LOG_MAX_ENTRIES,
  appendPassAlongLogEntry,
  passAlongLogPath,
  readPassAlongMessages
} from './session-canvas-pass-along-log'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'session-canvas-pass-along-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('passAlongLogPath', () => {
  it('nests the log file under the given userData dir', () => {
    expect(passAlongLogPath(dir)).toBe(join(dir, 'session-canvas-pass-along-log.json'))
  })
})

describe('appendPassAlongLogEntry / readPassAlongMessages', () => {
  it('starts empty when no log file exists yet', async () => {
    const messages = await readPassAlongMessages(passAlongLogPath(dir))
    expect(messages).toEqual([])
  })

  it('round-trips an appended entry as a pass-along message', async () => {
    const filePath = passAlongLogPath(dir)
    await appendPassAlongLogEntry(filePath, { fromPaneKey: 'pane-a', toPaneKey: 'pane-b', at: 100 })
    expect(await readPassAlongMessages(filePath)).toEqual([
      {
        fromPaneKey: 'pane-a',
        toPaneKey: 'pane-b',
        fromHandle: null,
        toHandle: null,
        at: 100,
        kind: 'pass-along'
      }
    ])
  })

  it('keeps only the newest PASS_ALONG_LOG_MAX_ENTRIES entries', async () => {
    const filePath = passAlongLogPath(dir)
    for (let i = 0; i < PASS_ALONG_LOG_MAX_ENTRIES + 10; i++) {
      await appendPassAlongLogEntry(filePath, { fromPaneKey: 'a', toPaneKey: 'b', at: i })
    }
    const messages = await readPassAlongMessages(filePath)
    expect(messages).toHaveLength(PASS_ALONG_LOG_MAX_ENTRIES)
    expect(messages[0]?.at).toBe(10)
    expect(messages.at(-1)?.at).toBe(PASS_ALONG_LOG_MAX_ENTRIES + 9)
  })

  it('writes atomically: no leftover tmp files, and the file is never observed empty mid-write', async () => {
    const filePath = passAlongLogPath(dir)
    await appendPassAlongLogEntry(filePath, { fromPaneKey: 'a', toPaneKey: 'b', at: 1 })
    await Promise.all([
      appendPassAlongLogEntry(filePath, { fromPaneKey: 'a', toPaneKey: 'b', at: 2 }),
      appendPassAlongLogEntry(filePath, { fromPaneKey: 'a', toPaneKey: 'b', at: 3 })
    ])
    const raw = readFileSync(filePath, 'utf-8')
    expect(() => JSON.parse(raw)).not.toThrow()
    const leftoverTmp = readdirSync(dir).filter((name) => name.endsWith('.tmp'))
    expect(leftoverTmp).toEqual([])
  })

  it('treats a corrupt log file as empty rather than throwing', async () => {
    const filePath = passAlongLogPath(dir)
    const { writeFileSync } = await import('node:fs')
    writeFileSync(filePath, '{ not valid json')
    expect(await readPassAlongMessages(filePath)).toEqual([])
  })
})

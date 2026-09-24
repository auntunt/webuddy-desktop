import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  stateHome,
  home,
  INDEX,
  codexPath,
  entryFor,
  writeManifest,
  paths
} from '../test-fixtures/manifest-fixture.mjs'

beforeEach(() => {
  rmSync(paths.outbox, { recursive: true, force: true })
  rmSync(paths.state, { force: true })
})

function cli(args) {
  return spawnSync(process.execPath, [INDEX, ...args], {
    env: { ...process.env, WEBUDDY_HOME: home, WEBUDDY_USER_ID: 'alice' },
    encoding: 'utf8'
  })
}

test('cli: per-entry problems exit 0 with a JSON summary; run-level failures exit non-zero', () => {
  const good = entryFor(codexPath, 'codex', 'codex-session-1')
  const { filePath: _omit, ...noFilePath } = entryFor(codexPath, 'codex', 'x')
  const path = join(stateHome, 'mixed.jsonl')
  writeFileSync(
    path,
    `{not json\n${JSON.stringify(noFilePath)}\n${JSON.stringify(
      entryFor(join(home, 'gone.jsonl'), 'codex', 'gone')
    )}\n${JSON.stringify(good)}\n`
  )
  const run = cli(['scan', '--manifest', path])
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(JSON.parse(run.stdout), { emitted: 1, skipped: 0, invalid: 2, unreadable: 1 })
  assert.equal(run.stderr.trim().split('\n').length, 3)

  assert.notEqual(cli(['scan', '--manifest', join(stateHome, 'nope.jsonl')]).status, 0)
  assert.equal(cli(['scan', '--manifest', '--json']).status, 2)

  // Outbox unwritable: a file where the directory should be.
  rmSync(paths.outbox, { recursive: true, force: true })
  rmSync(paths.state, { force: true })
  writeFileSync(paths.outbox, '')
  try {
    assert.notEqual(cli(['scan', '--manifest', writeManifest([good])]).status, 0)
  } finally {
    rmSync(paths.outbox, { force: true })
  }
})

test('cli: legacy discovery scan prints a deprecation notice', () => {
  const run = cli(['scan'])
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stderr, /deprecated/)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { openDb } from '../lib/db.mjs'
import { createUser } from '../lib/auth.mjs'
import { canSeeUser, groupMembers, resolveVisibleUsers } from '../lib/visibility.mjs'

function freshDb() {
  return openDb(join(mkdtempSync(join(tmpdir(), 'wb-vis-')), 'test.sqlite'))
}

function addGroup(db, id, name) {
  db.prepare('INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)').run(
    id,
    name,
    new Date().toISOString()
  )
}

function addUser(db, username, role, groupId = null) {
  const user = createUser(db, { username, password: 'password1', role })
  db.prepare('UPDATE users SET group_id = ? WHERE id = ?').run(groupId, user.id)
  return db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)
}

test('resolveVisibleUsers: admin/lead/member scopes', () => {
  const db = freshDb()
  addGroup(db, 'gA', 'A')
  addGroup(db, 'gB', 'B')
  const admin = addUser(db, 'root', 'admin')
  const lead = addUser(db, 'lead1', 'lead', 'gA')
  addUser(db, 'a1', 'member', 'gA')
  addUser(db, 'a2', 'member', 'gA')
  addUser(db, 'b1', 'member', 'gB')
  const loneLead = addUser(db, 'lone', 'lead')
  const member = addUser(db, 'solo', 'member')
  const groupedMember = db.prepare("SELECT * FROM users WHERE username = 'a1'").get()

  assert.equal(resolveVisibleUsers(db, admin), null)
  assert.deepEqual(resolveVisibleUsers(db, lead).sort(), ['a1', 'a2', 'lead1'])
  assert.deepEqual(resolveVisibleUsers(db, loneLead), ['lone'])
  assert.deepEqual(resolveVisibleUsers(db, member), ['solo'])
  assert.deepEqual(resolveVisibleUsers(db, groupedMember), ['a1'])
  assert.deepEqual(groupMembers(db, 'gB'), ['b1'])
  assert.deepEqual(groupMembers(db, 'nope'), [])
  db.close()
})

test('resolveVisibleUsers reads group from the db, not a stale auth object', () => {
  const db = freshDb()
  addGroup(db, 'gA', 'A')
  const lead = addUser(db, 'lead1', 'lead', 'gA')
  addUser(db, 'a1', 'member', 'gA')
  assert.deepEqual(resolveVisibleUsers(db, { ...lead, group_id: undefined }).sort(), [
    'a1',
    'lead1'
  ])
  db.close()
})

test('canSeeUser truth table', () => {
  assert.equal(canSeeUser(null, 'anyone'), true)
  assert.equal(canSeeUser(['a', 'b'], 'a'), true)
  assert.equal(canSeeUser(['a', 'b'], 'c'), false)
  assert.equal(canSeeUser([], 'a'), false)
  assert.equal(canSeeUser(['a'], undefined), false)
})

test('openDb migrates an old users table without group_id, idempotently', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'wb-mig-')), 'old.sqlite')
  const old = new DatabaseSync(path)
  old.exec(`CREATE TABLE users (
    id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT,
    role TEXT NOT NULL DEFAULT 'member', password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0)`)
  old.prepare("INSERT INTO users VALUES ('u1', 'old', 'old', 'member', 'x', '2026-01-01', 0)").run()
  old.close()

  const db = openDb(path)
  const columns = db
    .prepare('PRAGMA table_info(users)')
    .all()
    .map((c) => c.name)
  assert.ok(columns.includes('group_id'))
  const row = db.prepare("SELECT role, group_id FROM users WHERE id = 'u1'").get()
  assert.equal(row.role, 'member')
  assert.equal(row.group_id, null)
  db.close()
  assert.doesNotThrow(() => openDb(path).close())
})

/**
 * Group management (`/api/admin/groups*`, admin-only) and the read-only
 * `/api/groups` picker every logged-in role can call for its own filter UI.
 */

import { randomUUID } from 'node:crypto'
import { json, readBody } from './http-io.mjs'

function leadUsernames(db, groupId) {
  return db
    .prepare("SELECT username FROM users WHERE group_id = ? AND role = 'lead' ORDER BY username")
    .all(groupId)
    .map((row) => row.username)
}

function listGroupsWithCounts(db) {
  const groups = db.prepare('SELECT id, name, created_at FROM groups ORDER BY created_at').all()
  return groups.map((group) => ({
    ...group,
    member_count: db.prepare('SELECT COUNT(*) AS n FROM users WHERE group_id = ?').get(group.id).n,
    lead_usernames: leadUsernames(db, group.id)
  }))
}

function findGroupByName(db, name) {
  return db.prepare('SELECT id FROM groups WHERE name = ?').get(name) ?? null
}

/** `/api/auth/me` and the login response both want the group name alongside group_id. */
export function attachGroupName(db, user) {
  if (!user.group_id) {
    return { ...user, group_name: null }
  }
  const group = db.prepare('SELECT name FROM groups WHERE id = ?').get(user.group_id)
  return { ...user, group_name: group?.name ?? null }
}

async function readJsonBody(req) {
  const text = await readBody(req)
  return text ? JSON.parse(text) : {}
}

/** Handle /api/admin/groups* and /api/groups. Returns true when the route was ours. */
export async function handleGroupRoutes({ db, req, res, url, auth }) {
  const route = url.pathname

  if (route === '/api/groups' && req.method === 'GET') {
    if (auth.user.role === 'admin') {
      return (
        json(res, 200, { groups: db.prepare('SELECT id, name FROM groups ORDER BY name').all() }),
        true
      )
    }
    // Why reread from db: group membership may have changed since the token was issued.
    const row = db.prepare('SELECT group_id FROM users WHERE username = ?').get(auth.user.username)
    if (!row?.group_id) {
      return (json(res, 200, { groups: [] }), true)
    }
    const group = db.prepare('SELECT id, name FROM groups WHERE id = ?').get(row.group_id)
    return (json(res, 200, { groups: group ? [group] : [] }), true)
  }

  if (!route.startsWith('/api/admin/groups')) {
    return false
  }
  if (auth.user.role !== 'admin') {
    return (json(res, 403, { error: '需要管理员权限' }), true)
  }

  if (route === '/api/admin/groups' && req.method === 'GET') {
    return (json(res, 200, { groups: listGroupsWithCounts(db) }), true)
  }

  if (route === '/api/admin/groups' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const name = String(body.name ?? '').trim()
    if (!name) {
      return (json(res, 400, { error: '小组名不能为空' }), true)
    }
    if (findGroupByName(db, name)) {
      return (json(res, 409, { error: '小组名已存在' }), true)
    }
    const id = randomUUID()
    const created_at = new Date().toISOString()
    db.prepare('INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)').run(
      id,
      name,
      created_at
    )
    return (
      json(res, 201, { group: { id, name, created_at, member_count: 0, lead_usernames: [] } }), true
    )
  }

  if (route.startsWith('/api/admin/groups/')) {
    const id = decodeURIComponent(route.slice('/api/admin/groups/'.length))
    const existing = db.prepare('SELECT id, name, created_at FROM groups WHERE id = ?').get(id)

    if (req.method === 'PATCH') {
      if (!existing) {
        return (json(res, 404, { error: '小组不存在' }), true)
      }
      const body = await readJsonBody(req)
      const name = String(body.name ?? '').trim()
      if (!name) {
        return (json(res, 400, { error: '小组名不能为空' }), true)
      }
      const dupe = findGroupByName(db, name)
      if (dupe && dupe.id !== id) {
        return (json(res, 409, { error: '小组名已存在' }), true)
      }
      db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(name, id)
      const group = listGroupsWithCounts(db).find((g) => g.id === id)
      return (json(res, 200, { group }), true)
    }

    if (req.method === 'DELETE') {
      if (!existing) {
        return (json(res, 404, { error: '小组不存在' }), true)
      }
      // Why keep the lead role: 组被撤掉不该顺带抹掉这个人的角色，只是变成无组组长。
      db.prepare('UPDATE users SET group_id = NULL WHERE group_id = ?').run(id)
      db.prepare('DELETE FROM groups WHERE id = ?').run(id)
      return (json(res, 200, { ok: true }), true)
    }
  }

  return (json(res, 404, { error: 'not found' }), true)
}

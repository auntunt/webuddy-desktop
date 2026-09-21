/**
 * 待办同步：逐条合并，按日期裁决，冲突保留。
 *
 * 三种情况：
 *   1. 服务端没有这条 -> 插入
 *   2. 客户端上次看到的 rev 就是服务端当前 rev -> 无人竞争，直接采纳
 *   3. 服务端 rev 变了 -> 两边都动过：
 *        - 服务端 updatedAt 更新 -> 服务端赢，把服务端版本回给客户端
 *        - 客户端 updatedAt 更新 -> 客户端赢，但把服务端旧版留成 conflict 副本
 *
 * Why 保留而不是覆盖：两个人都以为自己在改同一条，静默丢掉一个是最坏的体验；
 * 留一份 conflict 副本让人自己看一眼，成本几乎为零。
 */

const now = () => new Date().toISOString()

function rowToJson(row) {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    dueDate: row.due_date,
    done: row.done === 1,
    rev: row.rev,
    updatedAt: row.updated_at,
    deleted: row.deleted === 1,
    conflictOf: row.conflict_of
  }
}

function insert(db, userId, id, item, { rev, conflictOf = null, deviceId = null }) {
  db.prepare(
    `INSERT INTO todos (id, user_id, title, notes, due_date, done, rev, updated_at, deleted, device_id, conflict_of)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    userId,
    String(item.title ?? ''),
    item.notes ?? null,
    item.dueDate ?? null,
    item.done ? 1 : 0,
    rev,
    item.updatedAt ?? now(),
    item.deleted ? 1 : 0,
    deviceId,
    conflictOf
  )
}

/**
 * Merge one client item. Returns what happened, so the response can tell the
 * client whether it won, lost, or produced a conflict copy.
 */
export function mergeTodo(db, userId, item, deviceId) {
  const existing = db
    .prepare('SELECT * FROM todos WHERE user_id = ? AND id = ?')
    .get(userId, item.id)
  if (!existing) {
    insert(db, userId, item.id, item, { rev: 1, deviceId })
    return { id: item.id, result: 'created' }
  }

  const clientSawThisRevision = Number(item.baseRev ?? 0) === existing.rev
  if (clientSawThisRevision) {
    db.prepare(
      `UPDATE todos SET title=?, notes=?, due_date=?, done=?, rev=rev+1, updated_at=?, deleted=?, device_id=?
       WHERE user_id=? AND id=?`
    ).run(
      String(item.title ?? ''),
      item.notes ?? null,
      item.dueDate ?? null,
      item.done ? 1 : 0,
      item.updatedAt ?? now(),
      item.deleted ? 1 : 0,
      deviceId,
      userId,
      item.id
    )
    return { id: item.id, result: 'updated' }
  }

  const serverIsNewer = String(existing.updated_at) > String(item.updatedAt ?? '')
  if (serverIsNewer) {
    return { id: item.id, result: 'server-wins', server: rowToJson(existing) }
  }

  // Client is newer: keep the server's version as a conflict copy before
  // overwriting, so nothing is lost.
  const conflictId = `${item.id}~conflict~${existing.rev}`
  const alreadyKept = db
    .prepare('SELECT 1 FROM todos WHERE user_id = ? AND id = ?')
    .get(userId, conflictId)
  if (!alreadyKept) {
    insert(
      db,
      userId,
      conflictId,
      {
        title: existing.title,
        notes: existing.notes,
        dueDate: existing.due_date,
        done: existing.done === 1,
        updatedAt: existing.updated_at,
        deleted: existing.deleted === 1
      },
      { rev: existing.rev, conflictOf: item.id, deviceId: existing.device_id }
    )
  }
  db.prepare(
    `UPDATE todos SET title=?, notes=?, due_date=?, done=?, rev=rev+1, updated_at=?, deleted=?, device_id=?
     WHERE user_id=? AND id=?`
  ).run(
    String(item.title ?? ''),
    item.notes ?? null,
    item.dueDate ?? null,
    item.done ? 1 : 0,
    item.updatedAt ?? now(),
    item.deleted ? 1 : 0,
    deviceId,
    userId,
    item.id
  )
  return { id: item.id, result: 'client-wins-with-conflict', conflictId }
}

/** Everything changed on the server since the client's watermark. */
export function pullSince(db, userId, sinceRev) {
  return db
    .prepare('SELECT * FROM todos WHERE user_id = ? AND rev > ? ORDER BY updated_at')
    .all(userId, Number(sinceRev) || 0)
    .map(rowToJson)
}

function currentMaxRev(db, userId) {
  const row = db
    .prepare('SELECT COALESCE(MAX(rev), 0) AS n FROM todos WHERE user_id = ?')
    .get(userId)
  return row.n
}

export function syncTodos(db, userId, { deviceId, since, items }) {
  const results = []
  db.exec('BEGIN')
  try {
    for (const item of items ?? []) {
      if (!item?.id) {
        continue
      }
      results.push(mergeTodo(db, userId, item, deviceId))
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  const cursor = currentMaxRev(db, userId)
  db.prepare(
    `INSERT INTO sync_cursors (user_id, device_id, last_rev, synced_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, device_id) DO UPDATE SET last_rev = excluded.last_rev, synced_at = excluded.synced_at`
  ).run(userId, String(deviceId ?? 'unknown'), cursor, now())
  return { results, cursor, items: pullSince(db, userId, since) }
}

export function listTodos(db, userId, { from, to } = {}) {
  const clauses = ['user_id = ?']
  const params = [userId]
  if (from) {
    clauses.push('due_date >= ?')
    params.push(from)
  }
  if (to) {
    clauses.push('due_date <= ?')
    params.push(to)
  }
  return db
    .prepare(`SELECT * FROM todos WHERE ${clauses.join(' AND ')} ORDER BY due_date, updated_at`)
    .all(...params)
    .map(rowToJson)
}

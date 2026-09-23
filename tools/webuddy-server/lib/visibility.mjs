/**
 * 三级可见范围的唯一入口：admin 不限（null），lead 看本组全体，member 只看自己。
 * 所有读接口都必须经这里决定能看谁。
 */

export function groupMembers(db, groupId) {
  if (!groupId) {
    return []
  }
  return db
    .prepare('SELECT username FROM users WHERE group_id = ? ORDER BY username')
    .all(groupId)
    .map((row) => row.username)
}

export function resolveVisibleUsers(db, authUser) {
  if (authUser.role === 'admin') {
    return null
  }
  if (authUser.role === 'lead') {
    // Why 重新查库：组员关系可能在 token 签发后被管理员改过。
    const row = db.prepare('SELECT group_id FROM users WHERE username = ?').get(authUser.username)
    const members = groupMembers(db, row?.group_id)
    return members.includes(authUser.username) ? members : [authUser.username]
  }
  return [authUser.username]
}

export function canSeeUser(visibleUsers, username) {
  if (visibleUsers === null) {
    return true
  }
  return Boolean(username) && visibleUsers.includes(username)
}

/**
 * Owner for per-person resources (skills, LLM analysis): default self; any
 * named user must be visible; `__all__` only when allowAll (admin). Returns
 * undefined when the caller may not see the target.
 */
export function resolveOwner(db, auth, wanted, { allowAll = false } = {}) {
  if (!wanted) {
    return auth.user.username
  }
  if (wanted === '__all__') {
    return allowAll && auth.user.role === 'admin' ? null : undefined
  }
  return canSeeUser(resolveVisibleUsers(db, auth.user), wanted) ? wanted : undefined
}

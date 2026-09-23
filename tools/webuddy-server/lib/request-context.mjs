/** Per-request identity and list-filter derivation, shared across routes. */

import { resolveToken } from './auth.mjs'
import { groupMembers, resolveVisibleUsers } from './visibility.mjs'

/** Resolve the caller's identity from a bearer token, or `?token=` for links. */
export function authenticate(db, req, url) {
  const header = req.headers.authorization ?? ''
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null
  return resolveToken(db, bearer ?? url.searchParams.get('token'))
}

export function filtersOf(url, auth, db) {
  const q = url.searchParams
  const groupId = q.get('group')
  return {
    visibleUsers: resolveVisibleUsers(db, auth.user),
    user: q.get('user') || undefined,
    group: groupId ? groupMembers(db, groupId) : undefined,
    agent: q.get('agent') || undefined,
    project: q.get('project') || undefined,
    from: q.get('from') || undefined,
    to: q.get('to') || undefined,
    q: q.get('q') || undefined
  }
}

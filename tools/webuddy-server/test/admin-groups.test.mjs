import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer } from './harness.mjs'

let server
const tokens = {}

async function seed() {
  server = await startTestServer()
  const root = server.createUser({ username: 'root', role: 'admin' })
  void root
  const lead1 = server.createUser({ username: 'lead1', role: 'member' })
  void lead1
  server.createUser({ username: 'mem1', role: 'member' })
  for (const username of ['root', 'lead1', 'mem1']) {
    tokens[username] = await server.login(username)
  }
}

before(seed)
after(() => server.close())

function api(who, path, init) {
  return server.api(tokens[who], path, init)
}

test('non-admin cannot manage groups', async () => {
  assert.equal((await api('mem1', '/api/admin/groups')).status, 403)
  assert.equal(
    (
      await api('mem1', '/api/admin/groups', {
        method: 'POST',
        body: JSON.stringify({ name: 'x' })
      })
    ).status,
    403
  )
})

test('create, rename, duplicate-name groups', async () => {
  const createRes = await api('root', '/api/admin/groups', {
    method: 'POST',
    body: JSON.stringify({ name: 'Alpha' })
  })
  assert.equal(createRes.status, 201)
  const { group } = await createRes.json()
  assert.equal(group.name, 'Alpha')

  const emptyName = await api('root', '/api/admin/groups', {
    method: 'POST',
    body: JSON.stringify({ name: '  ' })
  })
  assert.equal(emptyName.status, 400)

  const dupe = await api('root', '/api/admin/groups', {
    method: 'POST',
    body: JSON.stringify({ name: 'Alpha' })
  })
  assert.equal(dupe.status, 409)

  const renameRes = await api('root', `/api/admin/groups/${group.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: 'Alpha Team' })
  })
  assert.equal(renameRes.status, 200)
  assert.equal((await renameRes.json()).group.name, 'Alpha Team')

  assert.equal(
    (
      await api('root', '/api/admin/groups/does-not-exist', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Whatever' })
      })
    ).status,
    404
  )

  const second = await api('root', '/api/admin/groups', {
    method: 'POST',
    body: JSON.stringify({ name: 'Beta' })
  })
  const { group: beta } = await second.json()
  assert.equal(
    (
      await api('root', `/api/admin/groups/${beta.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Alpha Team' })
      })
    ).status,
    409
  )

  const list = await (await api('root', '/api/admin/groups')).json()
  const alpha = list.groups.find((g) => g.id === group.id)
  assert.equal(alpha.name, 'Alpha Team')
  assert.equal(alpha.member_count, 0)
  assert.deepEqual(alpha.lead_usernames, [])
})

test('lead scope follows group assignment; deleting group shrinks it to self', async () => {
  const createRes = await api('root', '/api/admin/groups', {
    method: 'POST',
    body: JSON.stringify({ name: 'Scope Group' })
  })
  const { group } = await createRes.json()

  const usersRes = await api('root', '/api/admin/users')
  const { users } = await usersRes.json()
  const lead1 = users.find((u) => u.username === 'lead1')
  const mem1 = users.find((u) => u.username === 'mem1')

  const promote = await api('root', `/api/admin/users/${lead1.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ role: 'lead', groupId: group.id })
  })
  assert.equal(promote.status, 200)
  assert.equal((await promote.json()).user.role, 'lead')

  await api('root', `/api/admin/users/${mem1.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ groupId: group.id })
  })

  await server.ingestSession(tokens.mem1, {
    actor: { userId: 'x', deviceId: 'dev-mem1', hostname: 'h', osUser: 'o', platform: 'darwin' }
  })

  const sessionsRes = await api('lead1', '/api/sessions')
  const { items } = await sessionsRes.json()
  assert.deepEqual(items.map((s) => s.user_id).sort(), ['mem1'])

  const badGroup = await api('root', `/api/admin/users/${mem1.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ groupId: 'no-such-group' })
  })
  assert.equal(badGroup.status, 400)

  const del = await api('root', `/api/admin/groups/${group.id}`, { method: 'DELETE' })
  assert.equal(del.status, 200)
  assert.deepEqual(await del.json(), { ok: true })

  const afterDelete = await (await api('lead1', '/api/sessions')).json()
  assert.deepEqual(afterDelete.items, [])

  const stillLead = await (await api('root', '/api/admin/users')).json()
  assert.equal(stillLead.users.find((u) => u.username === 'lead1').role, 'lead')
})

test('GET /api/groups shape differs by role', async () => {
  const groups = await (await api('root', '/api/admin/groups')).json()
  assert.ok(groups.groups.length > 0)

  const asAdmin = await (await api('root', '/api/groups')).json()
  assert.equal(asAdmin.groups.length, groups.groups.length)
  assert.ok('id' in asAdmin.groups[0] && 'name' in asAdmin.groups[0])

  const asLead = await (await api('lead1', '/api/groups')).json()
  assert.ok(Array.isArray(asLead.groups))

  const asMember = await (await api('mem1', '/api/groups')).json()
  assert.ok(Array.isArray(asMember.groups))
})

test('/api/auth/me includes group_id and group_name', async () => {
  const createRes = await api('root', '/api/admin/groups', {
    method: 'POST',
    body: JSON.stringify({ name: 'Me Group' })
  })
  const { group } = await createRes.json()
  const usersRes = await api('root', '/api/admin/users')
  const { users } = await usersRes.json()
  const mem1 = users.find((u) => u.username === 'mem1')
  await api('root', `/api/admin/users/${mem1.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ groupId: group.id })
  })

  const me = await (await api('mem1', '/api/auth/me')).json()
  assert.equal(me.user.group_id, group.id)
  assert.equal(me.user.group_name, 'Me Group')
})

test('last enabled admin cannot be demoted to lead', async () => {
  const usersRes = await api('root', '/api/admin/users')
  const { users } = await usersRes.json()
  const root = users.find((u) => u.username === 'root')
  const res = await api('root', `/api/admin/users/${root.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ role: 'lead' })
  })
  assert.equal(res.status, 400)
})

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { startTestServer } from './harness.mjs'

let server

before(async () => {
  const publicDir = mkdtempSync(join(tmpdir(), 'wb-public-'))
  mkdirSync(join(publicDir, 'assets'))
  writeFileSync(join(publicDir, 'index.html'), '<!doctype html><div id="root"></div>')
  writeFileSync(join(publicDir, 'assets', 'index-abc123.js'), 'console.log(1)')
  writeFileSync(join(publicDir, 'assets', 'index-abc123.css'), 'body{}')
  writeFileSync(join(publicDir, 'favicon.svg'), '<svg/>')
  server = await startTestServer({ publicDir })
})
after(() => server.close())

// fetch() normalizes `..` away, so traversal needs a raw request path.
function rawGet(path) {
  const { hostname, port } = new URL(server.baseUrl)
  return new Promise((resolve, reject) => {
    const req = request({ hostname, port, path, method: 'GET' }, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

test('hashed assets under assets/ get their type and a long immutable cache', async () => {
  const res = await fetch(`${server.baseUrl}/assets/index-abc123.js`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /^text\/javascript/)
  assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable')
  assert.equal(await res.text(), 'console.log(1)')

  const css = await fetch(`${server.baseUrl}/assets/index-abc123.css`)
  assert.match(css.headers.get('content-type'), /^text\/css/)
})

test('top-level files get their type; index.html is no-cache', async () => {
  const svg = await fetch(`${server.baseUrl}/favicon.svg`)
  assert.equal(svg.status, 200)
  assert.match(svg.headers.get('content-type'), /^image\/svg\+xml/)

  const root = await fetch(`${server.baseUrl}/`)
  assert.equal(root.status, 200)
  assert.match(root.headers.get('content-type'), /^text\/html/)
  assert.equal(root.headers.get('cache-control'), 'no-cache')
})

test('extensionless client routes fall back to index.html', async () => {
  for (const path of ['/people/lina', '/login', '/admin/users']) {
    const res = await fetch(`${server.baseUrl}${path}`)
    assert.equal(res.status, 200, path)
    assert.match(res.headers.get('content-type'), /^text\/html/)
    assert.equal(res.headers.get('cache-control'), 'no-cache')
    assert.match(await res.text(), /id="root"/)
  }
})

test('client routes with dots, dot-segments or extensions still get the SPA shell', async () => {
  const key = 'lina::claude-code::.claude/projects/x/abc.jsonl'
  for (const path of [`/sessions/${encodeURIComponent(key)}`, '/people/li.na', '/sessions/a.b.c']) {
    const res = await fetch(`${server.baseUrl}${path}`)
    assert.equal(res.status, 200, path)
    assert.match(res.headers.get('content-type'), /^text\/html/, path)
    assert.match(await res.text(), /id="root"/, path)
  }
})

test('a missing asset under /assets/ is a 404, not the SPA shell', async () => {
  const res = await fetch(`${server.baseUrl}/assets/missing.js`)
  assert.equal(res.status, 404)
})

test('path traversal never escapes publicDir', async () => {
  for (const path of [
    '/../server.mjs',
    '/assets/../../server.mjs',
    '/%2e%2e/server.mjs',
    '/%2e%2e%2fserver.mjs',
    '/assets/%2e%2e%2f%2e%2e%2fserver.mjs',
    '/..%2f..%2fpackage.json'
  ]) {
    const res = await rawGet(path)
    assert.doesNotMatch(res.body, /createRequestHandler|webuddy-server/, path)
  }
})

test('/api itself is an API route, not the SPA shell', async () => {
  const res = await fetch(`${server.baseUrl}/api`)
  assert.match(res.headers.get('content-type'), /application\/json/)
})

test('unknown /api/ routes are still JSON 404s', async () => {
  server.createUser({ username: 'viewer' })
  const res = await server.api(await server.login('viewer'), '/api/unknown')
  assert.equal(res.status, 404)
  assert.match(res.headers.get('content-type'), /application\/json/)
})

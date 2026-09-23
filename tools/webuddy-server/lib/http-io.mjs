/**
 * Low-level HTTP plumbing shared by every route: JSON responses, request-body
 * reading, and serving the dashboard's static assets.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const json = (res, code, body) => {
  const text = JSON.stringify(body)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text)
  })
  res.end(text)
}

export async function readBody(req, limitBytes = 64 * 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limitBytes) {
      throw new Error('payload too large')
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Dashboard assets. Served before the auth gate — the login page needs them. */
export async function serveStatic(res, route, publicDir) {
  const asset = route === '/' ? 'index.html' : route.slice(1)
  if (!/^[a-z0-9._-]+$/i.test(asset)) {
    return false
  }
  try {
    const body = await readFile(join(publicDir, asset))
    const type = asset.endsWith('.css')
      ? 'text/css'
      : asset.endsWith('.js')
        ? 'text/javascript'
        : 'text/html'
    res.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-cache' })
    res.end(body)
    return true
  } catch {
    return false
  }
}

/**
 * Serves the built dashboard (Vite output) with SPA fallback: client-side
 * routes such as /sessions/abc have no file on disk and get index.html.
 */

import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
}

// Vite fingerprints everything under assets/, so the name changes whenever the content does.
const IMMUTABLE = 'public, max-age=31536000, immutable'

/** Absolute path inside publicDir, or null when the route escapes it or names a dotfile. */
function resolveInside(publicDir, route) {
  let decoded
  try {
    decoded = decodeURIComponent(route)
  } catch {
    return null
  }
  if (decoded.includes('\0') || decoded.split('/').some((seg) => seg.startsWith('.'))) {
    return null
  }
  const root = resolve(publicDir)
  const file = resolve(root, `.${decoded}`)
  return file.startsWith(root + sep) ? file : null
}

async function send(res, file, cacheControl) {
  const body = await readFile(file)
  res.writeHead(200, {
    'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': body.length,
    'cache-control': cacheControl
  })
  res.end(body)
}

async function tryFile(res, file, cacheControl) {
  try {
    await send(res, file, cacheControl)
    return true
  } catch {
    return false
  }
}

/**
 * Real file with a known type → served. A route ending in a known static
 * extension but missing on disk → 404 (a missing chunk, or a bookmarked
 * /favicon.ico with none built, must not get HTML). Everything else →
 * index.html: client routes like /sessions/<key> may contain dots, `::` or
 * even `.claude/` segments, and their "extension" isn't a real static type.
 * Returns false when nothing was served, so the caller answers 404.
 */
export async function serveStatic(req, res, route, publicDir) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return false
  }
  const root = resolve(publicDir)
  const indexFile = resolve(root, 'index.html')
  // Rejected paths are never read; they can only be client routes.
  const file = route === '/' ? indexFile : resolveInside(root, route)
  const type = file && TYPES[extname(file).toLowerCase()]
  if (file && type) {
    const hashed = file.startsWith(resolve(root, 'assets') + sep)
    if (await tryFile(res, file, hashed ? IMMUTABLE : 'no-cache')) {
      return true
    }
    return false
  }
  return tryFile(res, indexFile, 'no-cache')
}

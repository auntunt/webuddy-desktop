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
  '.map': 'application/json; charset=utf-8'
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

/** Returns false when nothing was served, so the caller answers 404. */
export async function serveStatic(req, res, route, publicDir) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return false
  }
  const indexFile = resolve(publicDir, 'index.html')
  const file = route === '/' ? indexFile : resolveInside(publicDir, route)
  if (!file) {
    return false
  }
  const ext = extname(file)
  if (ext && TYPES[ext.toLowerCase()]) {
    try {
      const hashed = file.startsWith(resolve(publicDir, 'assets') + sep)
      await send(res, file, file === indexFile || !hashed ? 'no-cache' : IMMUTABLE)
      return true
    } catch {
      return false
    }
  }
  // Any extension we don't serve (or a missing asset) is a real 404, not the SPA shell.
  if (ext) {
    return false
  }
  try {
    await send(res, indexFile, 'no-cache')
    return true
  } catch {
    return false
  }
}

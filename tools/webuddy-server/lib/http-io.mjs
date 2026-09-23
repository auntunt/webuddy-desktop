/**
 * Low-level HTTP plumbing shared by every route: JSON responses and
 * request-body reading. Static serving lives in static-assets.mjs.
 */

export { serveStatic } from './static-assets.mjs'

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

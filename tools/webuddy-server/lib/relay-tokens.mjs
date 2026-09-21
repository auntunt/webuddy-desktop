/**
 * relay 用的 JWT 签发 + JWKS。
 *
 * relay 侧（cloud/apps/relay/src/relay-token-verifier.ts）要求：
 *   ES256 签名、iss === AUTH_ISSUER、aud === 'orca-relay'
 *   claims: { sub, prof, relayHostId: /^[A-Za-z0-9_-]{16}$/, purpose: 'host-control', exp }
 *
 * Why 自己签而不是跑 ORCA 的账号服务：relay 只验 JWKS，不认人。
 * 我们已经有用户表，加一个"签发 + 公钥"就够，不用再维护第二套用户体系。
 *
 * Why 零依赖手写 ES256：本服务一直是零依赖（node:http + node:sqlite）。
 * node:crypto 能直接生成 P-256 密钥并导出 JWK，JWT 就是 base64url 拼三段。
 * 注意签名要用 ieee-p1363 格式 —— JWT 要的是裸 r||s，不是 DER。
 */

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ALG = 'ES256'

/** 稳定地把 userId 变成 relay 认的 16 位 hostId（同一人每次登录都一样）。 */
export function relayHostIdFor(userId) {
  return createHash('sha256').update(`webuddy-relay-host:${userId}`).digest('base64url').slice(0, 16)
}

const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** 密钥落盘复用：重启后旧 token 仍然验得过，否则每次重启所有人都掉线。 */
export function loadOrCreateSigningKey(dataDir) {
  mkdirSync(dataDir, { recursive: true })
  const path = join(dataDir, 'relay-signing-key.json')
  if (existsSync(path)) {
    const saved = JSON.parse(readFileSync(path, 'utf8'))
    return { privateKey: createPrivateKey({ key: saved.privateJwk, format: 'jwk' }), publicJwk: saved.publicJwk }
  }
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const privateJwk = privateKey.export({ format: 'jwk' })
  const publicJwk = publicKey.export({ format: 'jwk' })
  writeFileSync(path, `${JSON.stringify({ privateJwk, publicJwk }, null, 2)}\n`, { mode: 0o600 })
  return { privateKey, publicJwk }
}

/** JWKS：relay 会定期来取，用于验我们签的 token。 */
export function jwksFor(publicJwk, kid) {
  return { keys: [{ ...publicJwk, kid, use: 'sig', alg: ALG }] }
}

export function signingKeyId(publicJwk) {
  return createHash('sha256').update(`${publicJwk.x}.${publicJwk.y}`).digest('base64url').slice(0, 16)
}

/**
 * 签发 host-control token。relay 用它认定"这台桌面属于谁"。
 */
export function mintRelayToken({ privateKey, kid, issuer, userId, profile = 'default', ttlSeconds = 3600 }) {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: ALG, typ: 'JWT', kid }
  const payload = {
    iss: issuer,
    aud: 'orca-relay',
    sub: userId,
    prof: profile,
    relayHostId: relayHostIdFor(userId),
    purpose: 'host-control',
    iat: now,
    exp: now + ttlSeconds
  }
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`
  // ieee-p1363 输出裸 r||s —— JWT 的 ES256 要的就是这个，DER 会验签失败
  const signature = sign('sha256', Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363'
  })
  return `${signingInput}.${b64url(signature)}`
}

export function decodePublicKeyForTest(publicJwk) {
  return createPublicKey({ key: publicJwk, format: 'jwk' })
}

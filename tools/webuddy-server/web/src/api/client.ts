import { clearToken, readToken } from '../auth/token-store'

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export type QueryValue = string | number | undefined | null

export type ApiFetchOptions = {
  method?: string
  body?: unknown
  query?: Record<string, QueryValue>
}

type UnauthorizedHandler = () => void

export const defaultUnauthorizedHandler: UnauthorizedHandler = () => {
  if (window.location.pathname !== '/login') {
    window.location.assign('/login')
  }
}

let onUnauthorized: UnauthorizedHandler | null = defaultUnauthorizedHandler

/** The app swaps in a router-aware handler; tests swap in a spy. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler
}

export function buildQueryString(query: Record<string, QueryValue> | undefined): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value))
    }
  }
  const text = params.toString()
  return text ? `?${text}` : ''
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json()
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
      return body.error
    }
  } catch {
    // Non-JSON error body: fall through to the status.
  }
  return `HTTP ${res.status}`
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const headers = new Headers()
  const token = readToken()
  if (token) {
    headers.set('authorization', `Bearer ${token}`)
  }
  let body: string | undefined
  if (options.body !== undefined) {
    headers.set('content-type', 'application/json')
    body = JSON.stringify(options.body)
  }
  const res = await fetch(`${path}${buildQueryString(options.query)}`, {
    method: options.method ?? 'GET',
    headers,
    body
  })
  // Without a token a 401 is just a failed login, not an expired session.
  if (res.status === 401 && token) {
    const message = await errorMessage(res)
    clearToken()
    onUnauthorized?.()
    throw new ApiError(401, message)
  }
  if (!res.ok) {
    throw new ApiError(res.status, await errorMessage(res))
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: callers name the response shape of the endpoint they call; the server owns that contract.
  return (await res.json()) as T
}

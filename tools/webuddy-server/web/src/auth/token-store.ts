// Same key as the old dashboard, so an existing session survives the switch.
const TOKEN_KEY = 'webuddy.token'

// Storage can throw (private mode, blocked site data); the in-memory copy keeps this tab signed in.
let memoryToken: string | null = null

export function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? memoryToken
  } catch {
    return memoryToken
  }
}

export function writeToken(token: string): void {
  memoryToken = token
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // Memory copy still works; the session just won't survive a reload.
  }
}

export function clearToken(): void {
  memoryToken = null
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Nothing stored, nothing to clear.
  }
}

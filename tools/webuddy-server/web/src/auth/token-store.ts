// Same key as the old dashboard, so an existing session survives the switch.
const TOKEN_KEY = 'webuddy.token'

// Storage can throw (private mode, blocked site data); treat that as "no token".
export function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function writeToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // Session still works for this tab; it just won't survive a reload.
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Nothing stored, nothing to clear.
  }
}

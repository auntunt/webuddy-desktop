import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import { useNavigate } from 'react-router'
import { apiFetch, defaultUnauthorizedHandler, setUnauthorizedHandler } from '../api/client'
import type { LoginResponse, Me, MeResponse } from '../api/types'
import { clearToken, readToken, writeToken } from './token-store'

type AuthValue = {
  token: string | null
  me: Me | undefined
  isLoadingMe: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthValue | null>(null)

export const ME_QUERY_KEY = ['auth', 'me'] as const

export function useMe(token: string | null) {
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: async () => (await apiFetch<MeResponse>('/api/auth/me')).user,
    enabled: token !== null,
    staleTime: 60_000
  })
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [token, setToken] = useState<string | null>(readToken)
  const meQuery = useMe(token)

  const login = useCallback(
    async (username: string, password: string) => {
      const res = await apiFetch<LoginResponse>('/api/auth/login', {
        method: 'POST',
        body: { username, password, label: 'dashboard' }
      })
      writeToken(res.token)
      queryClient.setQueryData(ME_QUERY_KEY, res.user)
      setToken(res.token)
    },
    [queryClient]
  )

  const logout = useCallback(() => {
    clearToken()
    setToken(null)
    // Drop every cached response so the next account never sees the previous one's data.
    queryClient.clear()
  }, [queryClient])

  const navigate = useNavigate()
  useEffect(() => {
    // Expired or revoked token: apiFetch already cleared storage; sync state and go to /login.
    setUnauthorizedHandler(() => {
      logout()
      navigate('/login', { replace: true })
    })
    return () => setUnauthorizedHandler(defaultUnauthorizedHandler)
  }, [logout, navigate])

  const value = useMemo<AuthValue>(
    () => ({
      token,
      me: token ? meQuery.data : undefined,
      isLoadingMe: token !== null && meQuery.isPending,
      login,
      logout
    }),
    [token, meQuery.data, meQuery.isPending, login, logout]
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) {
    throw new Error('useAuth must be used inside <AuthProvider>')
  }
  return value
}

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { apiFetch } from '../api/client'
import type {
  FacetsResponse,
  InsightsResponse,
  SessionsPage,
  StatsDimension,
  StatsResponse
} from '../api/session-types'
import type { GroupsResponse, Role } from '../api/types'

type ApiQuery = Record<string, string>

export const SESSIONS_PAGE_SIZE = 50

export function useFacets() {
  return useQuery({
    queryKey: ['facets'],
    queryFn: () => apiFetch<FacetsResponse>('/api/facets'),
    staleTime: 60_000
  })
}

export function useGroups() {
  return useQuery({
    queryKey: ['groups'],
    queryFn: () => apiFetch<GroupsResponse>('/api/groups'),
    staleTime: 60_000
  })
}

export function useInsights(query: ApiQuery, role: Role) {
  // Admin/lead with no person picked want the team total, not their own (often empty) account.
  const withUser = role !== 'member' && !query.user ? { ...query, user: '__all__' } : query
  return useQuery({
    queryKey: ['insights', withUser],
    queryFn: () => apiFetch<InsightsResponse>('/api/insights', { query: withUser }),
    placeholderData: keepPreviousData
  })
}

export function useStats(by: StatsDimension, query: ApiQuery, enabled = true) {
  const withDimension = { ...query, by, limit: '500' }
  return useQuery({
    queryKey: ['stats', withDimension],
    queryFn: () => apiFetch<StatsResponse>('/api/stats', { query: withDimension }),
    placeholderData: keepPreviousData,
    enabled
  })
}

export function useSessionsPage(query: ApiQuery, offset: number) {
  const withPage = { ...query, limit: SESSIONS_PAGE_SIZE, offset }
  return useQuery({
    queryKey: ['sessions', withPage],
    queryFn: () => apiFetch<SessionsPage>('/api/sessions', { query: withPage }),
    placeholderData: keepPreviousData
  })
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../api/client'
import type {
  AdminGroup,
  AdminGroupsResponse,
  AdminUser,
  AdminUsersResponse,
  CreateUserPayload,
  UpdateUserPayload,
  UserTokensResponse
} from '../api/admin-types'

export const ADMIN_USERS_KEY = ['admin', 'users'] as const
export const ADMIN_GROUPS_KEY = ['admin', 'groups'] as const

export function adminTokensKey(userId: string) {
  return ['admin', 'tokens', userId] as const
}

export function useAdminUsers() {
  return useQuery({
    queryKey: ADMIN_USERS_KEY,
    queryFn: () => apiFetch<AdminUsersResponse>('/api/admin/users')
  })
}

export function useAdminGroups() {
  return useQuery({
    queryKey: ADMIN_GROUPS_KEY,
    queryFn: () => apiFetch<AdminGroupsResponse>('/api/admin/groups')
  })
}

export function useUserTokens(userId: string | null) {
  return useQuery({
    queryKey: adminTokensKey(userId ?? ''),
    queryFn: () => apiFetch<UserTokensResponse>(`/api/admin/users/${userId}/tokens`),
    enabled: userId !== null
  })
}

function useInvalidate(key: readonly unknown[]) {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: key })
}

export function useCreateUser() {
  const invalidateUsers = useInvalidate(ADMIN_USERS_KEY)
  return useMutation({
    mutationFn: (payload: CreateUserPayload) =>
      apiFetch<{ user: AdminUser }>('/api/admin/users', { method: 'POST', body: payload }),
    onSuccess: invalidateUsers
  })
}

export function useUpdateUser(userId: string) {
  const invalidateUsers = useInvalidate(ADMIN_USERS_KEY)
  return useMutation({
    mutationFn: (payload: UpdateUserPayload) =>
      apiFetch<{ user: AdminUser }>(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        body: payload
      }),
    onSuccess: invalidateUsers
  })
}

export function useCreateGroup() {
  const invalidateGroups = useInvalidate(ADMIN_GROUPS_KEY)
  return useMutation({
    mutationFn: (name: string) =>
      apiFetch<{ group: AdminGroup }>('/api/admin/groups', { method: 'POST', body: { name } }),
    onSuccess: invalidateGroups
  })
}

export function useUpdateGroup(groupId: string) {
  const invalidateGroups = useInvalidate(ADMIN_GROUPS_KEY)
  return useMutation({
    mutationFn: (name: string) =>
      apiFetch<{ group: AdminGroup }>(`/api/admin/groups/${groupId}`, {
        method: 'PATCH',
        body: { name }
      }),
    onSuccess: invalidateGroups
  })
}

export function useDeleteGroup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (groupId: string) =>
      apiFetch<{ ok: boolean }>(`/api/admin/groups/${groupId}`, { method: 'DELETE' }),
    // Deleting a group also clears its members' group_id server-side.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADMIN_GROUPS_KEY })
      queryClient.invalidateQueries({ queryKey: ADMIN_USERS_KEY })
    }
  })
}

export function useRevokeToken(userId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (tokenId: string) =>
      apiFetch<{ revoked: boolean }>(`/api/admin/tokens/${tokenId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminTokensKey(userId) })
      queryClient.invalidateQueries({ queryKey: ADMIN_USERS_KEY })
    }
  })
}

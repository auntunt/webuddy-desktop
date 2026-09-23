import type { Role } from './types'

export type AdminUser = {
  id: string
  username: string
  display_name: string | null
  role: Role
  created_at: string
  disabled: number
  session_count: number
  last_active: string | null
  token_count: number
  group_id: string | null
  group_name: string | null
}

export type AdminUsersResponse = { users: AdminUser[] }

export type CreateUserPayload = {
  username: string
  password: string
  displayName: string
  role: Role
  groupId?: string | null
}

export type UpdateUserPayload = {
  displayName?: string
  role?: Role
  groupId?: string | null
  password?: string
  disabled?: boolean
}

export type UserToken = {
  id: string
  label: string | null
  created_at: string
  expires_at: string | null
  last_used_at: string | null
}

export type UserTokensResponse = { tokens: UserToken[] }

export type AdminGroup = {
  id: string
  name: string
  created_at: string
  member_count: number
  lead_usernames: string[]
}

export type AdminGroupsResponse = { groups: AdminGroup[] }

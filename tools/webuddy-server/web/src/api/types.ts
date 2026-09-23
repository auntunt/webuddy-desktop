export type Role = 'admin' | 'lead' | 'member'

// User and group ids are server-generated UUIDs (TEXT columns).
export type Me = {
  id: string
  username: string
  display_name: string | null
  role: Role
  group_id: string | null
  group_name: string | null
}

export type LoginResponse = {
  token: string
  user: Me
}

export type MeResponse = {
  user: Me
}

export type Group = {
  id: string
  name: string
}

export type GroupsResponse = {
  groups: Group[]
}

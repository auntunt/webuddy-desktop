export type Role = 'admin' | 'lead' | 'member'

export type Me = {
  id: number
  username: string
  display_name: string | null
  role: Role
  group_id: number | null
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
  id: number
  name: string
}

export type GroupsResponse = {
  groups: Group[]
}

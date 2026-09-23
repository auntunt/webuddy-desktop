/** Response shapes of the read endpoints the overview and session pages use. */

export type FacetValue = { value: string; n: number }

export type FacetsResponse = {
  people: FacetValue[]
  agents: FacetValue[]
  projects: (FacetValue & { last_day: string | null })[]
  dates: { min: string | null; max: string | null }
}

export type StatsDimension = 'person' | 'agent' | 'day' | 'project' | 'branch'

export type StatsGroup = {
  key: string | null
  sessions: number
  turns: number
  tokens: number
  duration_ms: number
  first_date: string | null
  last_date: string | null
}

export type StatsResponse = {
  totals: {
    sessions: number
    people: number
    turns: number
    messages: number
    bytes: number
    tokens: number
    duration_ms: number
  }
  groups: StatsGroup[]
}

export type InsightsOverall = {
  sessions: number
  active_days: number
  first_day: string | null
  last_day: string | null
  duration_ms: number
  turns: number
  messages: number
  tokens: number
  bytes: number
  projects: number
  clamped_sessions: number
  longest_raw_ms: number
  span_days: number
  avg_duration_per_active_day: number
  avg_sessions_per_active_day: number
  duration_is_clamped: boolean
}

export type InsightsResponse = { overall: InsightsOverall }

export type SessionListItem = {
  dedupe_key: string
  user_id: string
  device_label: string | null
  agent_id: string
  agent_label: string | null
  agent_model: string | null
  agent_version: string | null
  session_id: string
  local_date: string
  started_at: string | null
  ended_at: string | null
  duration_ms: number | null
  turn_count: number | null
  message_count: number | null
  tokens_total: number | null
  cwd: string | null
  branch: string | null
  transcript_bytes: number | null
  transcript_sha256: string | null
  consent_scope: string | null
  redaction_rules: string | null
  transcript_truncated: number | null
  received_at: string | null
}

export type SessionsPage = {
  items: SessionListItem[]
  total: number
  limit: number
  offset: number
}

export type SessionDetail = SessionListItem & {
  hostname: string | null
  transcript_body: string | null
}

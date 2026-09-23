/** Response shapes of the skill-library endpoints. */

export type Skill = {
  id: number
  user_id: string
  title: string
  summary: string | null
  body: string
  tags: string[]
  evidence: string | null
  model: string | null
  source_sessions: number | null
  created_at: string
}

export type SkillsResponse = { userId: string; items: Skill[] }

export type SkillExtractSkipReason = 'no-api-key' | 'no-new-data'

export type ExtractSkillsResult =
  | { skipped: SkillExtractSkipReason }
  | { userId: string; model: string; extracted: number; inputTokens: number; outputTokens: number }

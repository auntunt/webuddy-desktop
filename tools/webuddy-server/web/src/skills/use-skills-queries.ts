import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../api/client'
import type { ExtractSkillsResult, SkillsResponse } from '../api/skill-types'

export function skillsQueryKey(user: string) {
  return ['skills', user] as const
}

export function useSkills(user: string) {
  return useQuery({
    queryKey: skillsQueryKey(user),
    queryFn: () => apiFetch<SkillsResponse>('/api/skills', { query: { user } })
  })
}

export function useExtractSkills(user: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiFetch<ExtractSkillsResult>('/api/skills/extract', { method: 'POST', query: { user } }),
    // Failures are recorded server-side too, so refresh lastRun either way.
    onSettled: () => queryClient.invalidateQueries({ queryKey: skillsQueryKey(user) })
  })
}

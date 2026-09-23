import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../api/client'
import type { AnalysisResponse, RunAnalysisResult } from '../api/analysis-types'

export function analysisQueryKey(user: string) {
  return ['analysis', user] as const
}

export function useAnalysis(user: string) {
  return useQuery({
    queryKey: analysisQueryKey(user),
    queryFn: () => apiFetch<AnalysisResponse>('/api/analysis/llm', { query: { user } })
  })
}

export function useRunAnalysis(user: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiFetch<RunAnalysisResult>('/api/analysis/llm/run', { method: 'POST', query: { user } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: analysisQueryKey(user) })
  })
}

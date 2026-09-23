/** Response shapes of the AI-analysis endpoints. */

export type AnalysisContent = {
  model: string
  createdAt: string
  sessionsCovered: number
  inputTokens: number
  outputTokens: number
  content: string
}

export type AnalysisEmpty = { content: null; hint: string }

export type AnalysisResponse = AnalysisContent | AnalysisEmpty

export type AnalysisSkipReason = 'no-api-key' | 'no-new-data'

export type RunAnalysisResult =
  | { skipped: AnalysisSkipReason }
  | { model: string; inputTokens: number; outputTokens: number; content: string }

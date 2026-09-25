import { describe, expect, it } from 'vitest'
import { normalizeAgentStatusPayload } from '../../../shared/agent-status-types'
import { isOrcaDispatchStatusPrompt } from '../../../shared/orca-dispatch-status-prompt'
import { buildDispatchPreamble } from './preamble'

describe('dispatch preamble status detection', () => {
  it('recognizes the preamble this build emits so the task body survives compaction', () => {
    const preamble = buildDispatchPreamble({
      taskId: 'task_detect_1',
      dispatchId: 'ctx_detect_1',
      taskSpec: 'Ship the detection regression fix',
      coordinatorHandle: 'term_coord',
      workerHandle: 'term_worker'
    })

    expect(isOrcaDispatchStatusPrompt(preamble)).toBe(true)
    const compacted = normalizeAgentStatusPayload({ state: 'working', prompt: preamble })!.prompt
    expect(compacted).toContain('Your task ID is: task_detect_1')
    expect(compacted).toContain('=== TASK === Ship the detection regression fix')
  })
})

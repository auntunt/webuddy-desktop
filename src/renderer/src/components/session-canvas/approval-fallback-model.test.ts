import { describe, expect, it } from 'vitest'
import { resolveSessionApproval } from './approval-fallback-model'

const ESC = String.fromCharCode(27)
const envelope = JSON.stringify({ approval: { tool: 'Bash', summary: 'rm -rf build' } })

describe('resolveSessionApproval', () => {
  it('ignores sessions that are not paused on the user', () => {
    expect(resolveSessionApproval({ state: 'working', interactivePrompt: envelope })).toBeNull()
    expect(resolveSessionApproval({ state: 'done', interactivePrompt: envelope })).toBeNull()
  })

  it('uses the structured approval envelope with the native-chat keys', () => {
    const approval = resolveSessionApproval({ state: 'waiting', interactivePrompt: envelope })
    expect(approval?.detail).toBe('rm -rf build')
    expect(approval?.options.map((option) => option.send)).toEqual(['1', ESC])
  })

  it('prefers the numbered menu the agent printed over the envelope defaults', () => {
    const approval = resolveSessionApproval({
      state: 'blocked',
      interactivePrompt: envelope,
      lastAssistantMessage:
        "Do you want to proceed?\n1. Yes\n2. Yes, and don't ask again\n3. No, and tell Claude"
    })
    expect(approval?.options).toEqual([
      { label: 'Yes', send: '1' },
      { label: "Yes, and don't ask again", send: '2' },
      { label: 'No, and tell Claude', send: '3' }
    ])
  })

  it('falls back to y/n when the text reads like a permission ask', () => {
    const approval = resolveSessionApproval({
      state: 'waiting',
      lastAssistantMessage: 'Allow writing to package.json? (y/n)'
    })
    expect(approval?.options.map((option) => option.send)).toEqual(['y', 'n'])
    expect(approval?.detail).toBe('Allow writing to package.json? (y/n)')
  })

  it('offers "always" only when the text offers it', () => {
    const approval = resolveSessionApproval({
      state: 'waiting',
      lastAssistantMessage: 'Grant permission for this session? (y/n)'
    })
    expect(approval?.options.map((option) => option.send)).toEqual(['y', 'a', 'n'])
  })

  it('stays quiet for ordinary prose and for structured questions', () => {
    expect(
      resolveSessionApproval({ state: 'waiting', lastAssistantMessage: 'I finished the refactor.' })
    ).toBeNull()
    const question = JSON.stringify({
      questions: [{ question: 'Which db?', options: [{ label: 'pg' }, { label: 'sqlite' }] }]
    })
    expect(
      resolveSessionApproval({
        state: 'waiting',
        toolName: 'AskUserQuestion',
        interactivePrompt: question,
        lastAssistantMessage: 'Would you like to pick one?'
      })
    ).toBeNull()
  })
})

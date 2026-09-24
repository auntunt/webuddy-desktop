import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ConversationMessage } from '../api/session-types'
import { formatDateTime } from '../format/date-format'
import { ConversationView, MESSAGE_COLLAPSE_CHARS } from './ConversationView'

function message(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return { role: 'user', text: 'hi', timestamp: '2026-01-01T00:00:00.000Z', ...overrides }
}

describe('ConversationView', () => {
  it('renders each message with a role badge and timestamp', () => {
    render(
      <ConversationView
        conversation={[
          message({ role: 'user', text: '把重试改成指数退避' }),
          message({ role: 'assistant', text: '好的' })
        ]}
        truncated={false}
        transcriptBody={null}
        transcriptBytes={null}
      />
    )
    expect(screen.getByText('把重试改成指数退避')).toBeInTheDocument()
    expect(screen.getByText('好的')).toBeInTheDocument()
    expect(screen.getByText('用户')).toBeInTheDocument()
    expect(screen.getByText('助手')).toBeInTheDocument()
    expect(screen.getAllByText(formatDateTime('2026-01-01T00:00:00.000Z'))).toHaveLength(2)
  })

  it('styles system and tool roles distinctly from user/assistant', () => {
    render(
      <ConversationView
        conversation={[
          message({ role: 'system', text: 's' }),
          message({ role: 'tool', text: 't' })
        ]}
        truncated={false}
        transcriptBody={null}
        transcriptBytes={null}
      />
    )
    expect(screen.getByText('系统')).toBeInTheDocument()
    expect(screen.getByText('工具')).toBeInTheDocument()
  })

  it('collapses a message longer than the cap and expands it on click', async () => {
    const long = 'x'.repeat(MESSAGE_COLLAPSE_CHARS + 500)
    render(
      <ConversationView
        conversation={[message({ text: long })]}
        truncated={false}
        transcriptBody={null}
        transcriptBytes={null}
      />
    )
    expect(screen.getByText(/^x+…$/).textContent).toHaveLength(MESSAGE_COLLAPSE_CHARS + 1)
    await userEvent.setup().click(screen.getByRole('button', { name: '展开' }))
    expect(screen.getByText(long)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '收起' })).toBeInTheDocument()
  })

  it('shows a truncation notice when the conversation was clipped', () => {
    render(
      <ConversationView
        conversation={[message()]}
        truncated={true}
        transcriptBody={null}
        transcriptBytes={null}
      />
    )
    expect(
      screen.getByText('对话过长，已省略部分内容（保留开头与最近的消息，超长消息已截断）')
    ).toBeInTheDocument()
  })

  it('falls back to the raw transcript when there is no conversation', () => {
    render(
      <ConversationView
        conversation={null}
        truncated={false}
        transcriptBody="raw transcript text"
        transcriptBytes={20}
      />
    )
    expect(screen.getByTestId('transcript')).toHaveTextContent('raw transcript text')
  })

  it('toggles to the raw record and back', async () => {
    render(
      <ConversationView
        conversation={[message({ text: '气泡内容' })]}
        truncated={false}
        transcriptBody="raw transcript text"
        transcriptBytes={20}
      />
    )
    expect(screen.getByText('气泡内容')).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '原始记录' }))
    expect(screen.getByTestId('transcript')).toHaveTextContent('raw transcript text')
    expect(screen.queryByText('气泡内容')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '按对话显示' }))
    expect(screen.getByText('气泡内容')).toBeInTheDocument()
  })

  it('renders a literal <script> tag as text, never as markup', () => {
    const { container } = render(
      <ConversationView
        conversation={[message({ text: '<script>alert(1)</script>' })]}
        truncated={false}
        transcriptBody={null}
        transcriptBytes={null}
      />
    )
    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument()
    expect(container.querySelector('script')).toBeNull()
  })

  it('renders identical repeated messages without duplicate-key warnings', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ConversationView
        conversation={[message({ text: '继续' }), message({ text: '继续' })]}
        truncated={false}
        transcriptBody={null}
        transcriptBytes={null}
      />
    )
    expect(screen.getAllByText('继续')).toHaveLength(2)
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })
})

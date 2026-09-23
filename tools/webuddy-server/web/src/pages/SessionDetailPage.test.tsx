import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiFetch } from '../api/client'
import type { SessionDetail } from '../api/session-types'
import { sessionRow } from '../overview/session-row-fixture'
import { sessionPath } from '../overview/SessionsTable'
import { TRANSCRIPT_PREVIEW_CHARS } from '../session-detail/TranscriptView'
import { SessionDetailPage } from './SessionDetailPage'

vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetch: vi.fn()
}))

const apiFetchMock = vi.mocked(apiFetch)
const KEY = 'dev-1::claude-code::s1::/Users/lina/.claude/projects/x.jsonl'

function detail(body: string | null): SessionDetail {
  return { ...sessionRow({ dedupe_key: KEY }), hostname: 'lina-mbp', transcript_body: body }
}

function OverviewProbe() {
  return <p>overview{useLocation().search}</p>
}

const OTHER_KEY = 'dev-1::codex::s2::/Users/lina/.codex/sessions/y.jsonl'

function OpenOther() {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => navigate(sessionPath(OTHER_KEY))}>
      open-other
    </button>
  )
}

function renderDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/?agent=codex', sessionPath(KEY)]} initialIndex={1}>
        <Routes>
          <Route index element={<OverviewProbe />} />
          <Route path="sessions/:key" element={<SessionDetailPage />} />
        </Routes>
        <OpenOther />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

afterEach(() => {
  apiFetchMock.mockReset()
})

describe('SessionDetailPage', () => {
  it('shows grouped metadata and the transcript as-is', async () => {
    apiFetchMock.mockResolvedValue(detail('user: <hi>\n  assistant: ok'))
    renderDetail()
    expect(await screen.findByText('user: <hi>', { exact: false })).toBeInTheDocument()
    expect(apiFetchMock).toHaveBeenCalledWith(`/api/sessions/${encodeURIComponent(KEY)}`)
    for (const title of ['身份', '时间', '规模', '位置', '合规']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
    }
    expect(screen.getByText('/Users/lina/work/webuddy-desktop')).toBeInTheDocument()
  })

  it('previews a huge transcript and reveals the rest on demand', async () => {
    const body = `${'a'.repeat(TRANSCRIPT_PREVIEW_CHARS)}TAIL`
    apiFetchMock.mockResolvedValue(detail(body))
    renderDetail()
    const pre = await screen.findByTestId('transcript')
    expect(pre.textContent).toHaveLength(TRANSCRIPT_PREVIEW_CHARS)
    await userEvent.setup().click(screen.getByRole('button', { name: /显示全部/ }))
    expect(screen.getByTestId('transcript').textContent?.endsWith('TAIL')).toBe(true)
  })

  it('states the preview limit in characters', async () => {
    apiFetchMock.mockResolvedValue(detail('a'.repeat(TRANSCRIPT_PREVIEW_CHARS + 1)))
    renderDetail()
    expect(await screen.findByText(/先显示前 200 万字符/)).toBeInTheDocument()
  })

  it('does not carry "显示全部" over to the next session', async () => {
    const body = `${'a'.repeat(TRANSCRIPT_PREVIEW_CHARS)}TAIL`
    apiFetchMock.mockResolvedValue(detail(body))
    renderDetail()
    const user = userEvent.setup()
    // Visit the other session once so it is cached and renders without a loading gap.
    await screen.findByRole('button', { name: /显示全部/ })
    await user.click(screen.getByRole('button', { name: 'open-other' }))
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(`/api/sessions/${encodeURIComponent(OTHER_KEY)}`)
    )
    await user.click(await screen.findByRole('button', { name: /返回/ }))
    await user.click(await screen.findByRole('button', { name: /显示全部/ }))
    await user.click(screen.getByRole('button', { name: 'open-other' }))
    expect(await screen.findByRole('button', { name: /显示全部/ })).toBeInTheDocument()
  })

  it('explains a missing or hidden session', async () => {
    apiFetchMock.mockRejectedValue(new ApiError(404, 'not found'))
    renderDetail()
    expect(await screen.findByText(/会话不存在，或你没有权限查看/)).toBeInTheDocument()
  })

  it('goes back to the list with its filters', async () => {
    apiFetchMock.mockResolvedValue(detail(null))
    renderDetail()
    await userEvent.setup().click(await screen.findByRole('button', { name: /返回/ }))
    expect(screen.getByText('overview?agent=codex')).toBeInTheDocument()
  })
})

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MarkdownView } from './MarkdownView'

describe('MarkdownView', () => {
  it('renders GFM markdown: headings, lists and tables', () => {
    render(
      <MarkdownView
        content={['## 标题', '', '- 一', '- 二', '', '| a | b |', '| - | - |', '| 1 | 2 |'].join(
          '\n'
        )}
      />
    )
    expect(screen.getByRole('heading', { name: '标题' })).toBeInTheDocument()
    expect(screen.getByText('一')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  it('opens links in a new tab without leaking a referrer', () => {
    render(<MarkdownView content="[点这里](https://example.com)" />)
    const link = screen.getByRole('link', { name: '点这里' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
  })

  it('never renders raw HTML embedded in the content', () => {
    render(<MarkdownView content='<img src=x onerror="window.__hit = true" />正文' />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText(/正文/)).toBeInTheDocument()
  })
})

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

  it('never renders a javascript:/data:/vbscript: href or src, case- and whitespace-insensitively', () => {
    const { container } = render(
      <MarkdownView
        content={[
          '[a](javascript:alert(1))',
          '[b](data:text/html,<script>alert(1)</script>)',
          '[c](vbscript:x)',
          '[d]( JaVaScRiPt:alert(1))',
          '![i](javascript:alert(1))'
        ].join('\n\n')}
      />
    )
    const dangerous = /^\s*(javascript|data|vbscript):/i
    for (const el of container.querySelectorAll('a')) {
      const href = el.getAttribute('href')
      expect(href).not.toMatch(dangerous)
    }
    for (const el of container.querySelectorAll('img')) {
      const src = el.getAttribute('src')
      expect(src).not.toMatch(dangerous)
    }
    // The stripped links render as plain text, not live anchors.
    expect(screen.queryByRole('link', { name: 'a' })).not.toBeInTheDocument()
    expect(screen.getByText('a')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})

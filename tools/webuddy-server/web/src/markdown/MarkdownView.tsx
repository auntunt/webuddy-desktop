import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Model output is untrusted text: skipHtml (no rehype-raw) keeps raw HTML from rendering.
const COMPONENTS: Components = {
  a: ({ children, ...props }) => (
    <a
      {...props}
      target="_blank"
      rel="noreferrer"
      className="text-accent underline underline-offset-2"
    >
      {children}
    </a>
  ),
  h1: ({ children }) => <h3 className="text-[15px] font-semibold">{children}</h3>,
  h2: ({ children }) => <h4 className="text-sm font-semibold">{children}</h4>,
  h3: ({ children }) => <h5 className="text-sm font-medium">{children}</h5>,
  code: ({ children }) => (
    <code className="rounded-control bg-raised px-1 py-0.5 font-mono text-[12px]">{children}</code>
  ),
  ul: ({ children }) => <ul className="list-disc pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5">{children}</ol>,
  table: ({ children }) => (
    <table className="w-full border-collapse text-left text-[12.5px]">{children}</table>
  ),
  th: ({ children }) => <th className="border-b border-line px-2 py-1 font-medium">{children}</th>,
  td: ({ children }) => <td className="border-b border-line px-2 py-1">{children}</td>
}

/** Renders model-produced markdown: GFM, no raw HTML, external links open in a new tab. */
export function MarkdownView({ content }: { content: string }) {
  return (
    <div className="flex flex-col gap-2 text-[13.5px] leading-[1.85] text-fg">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={COMPONENTS}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

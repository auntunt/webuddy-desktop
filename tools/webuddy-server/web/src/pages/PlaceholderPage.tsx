import { useParams } from 'react-router'
import { EmptyState } from '../components/ui/EmptyState'

// Stand-in until the real pages land (tasks 5–7).
export function PlaceholderPage({ title }: { title: string }) {
  const { key } = useParams()
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      <EmptyState title="页面建设中" hint={key ? `会话 ${key}` : undefined} />
    </div>
  )
}

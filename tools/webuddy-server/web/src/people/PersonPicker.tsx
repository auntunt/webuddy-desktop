import type { FacetValue } from '../api/session-types'
import type { Me } from '../api/types'
import { Select } from '../components/ui/Select'

type PersonPickerProps = {
  me: Me
  people: FacetValue[]
  value: string
  onChange: (value: string) => void
  /** "全组" is only meaningful where the endpoint accepts an admin-only `__all__` owner. */
  allowAll?: boolean
}

/** admin: all visible people (+ 全组 where allowed); lead: own group; member: none (self only). */
export function PersonPicker({ me, people, value, onChange, allowAll = false }: PersonPickerProps) {
  if (me.role === 'member') {
    return null
  }
  // An admin/lead's own username is often absent from the facets people list (no data of their
  // own yet); without this the <select> silently shows the first option while querying a
  // username that isn't rendered anywhere, so the displayed value no longer matches the query.
  const hasSelf = people.some((p) => p.value === me.username)
  const options = [
    ...(me.role === 'admin' && allowAll ? [{ value: '__all__', label: '全组' }] : []),
    ...(hasSelf ? [] : [{ value: me.username, label: `我（${me.username}）` }]),
    ...people.map((p) => ({ value: p.value, label: p.value }))
  ]
  return (
    <Select
      aria-label="人员"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      options={options}
    />
  )
}

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Me, Role } from '../api/types'
import { PersonPicker } from './PersonPicker'

function me(role: Role): Me {
  return { id: 'u-1', username: 'lina', display_name: null, role, group_id: null, group_name: null }
}

const people = [
  { value: 'lina', n: 3 },
  { value: 'wang', n: 1 }
]

describe('PersonPicker', () => {
  it('renders nothing for a member', () => {
    const { container } = render(
      <PersonPicker me={me('member')} people={people} value="lina" onChange={vi.fn()} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('lists the group for a lead without a 全组 option', () => {
    render(
      <PersonPicker me={me('lead')} people={people} value="lina" onChange={vi.fn()} allowAll />
    )
    expect(screen.queryByRole('option', { name: '全组' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'wang' })).toBeInTheDocument()
  })

  it('adds 全组 for an admin only when allowAll is set', () => {
    const { rerender } = render(
      <PersonPicker me={me('admin')} people={people} value="lina" onChange={vi.fn()} />
    )
    expect(screen.queryByRole('option', { name: '全组' })).not.toBeInTheDocument()
    rerender(
      <PersonPicker me={me('admin')} people={people} value="lina" onChange={vi.fn()} allowAll />
    )
    expect(screen.getByRole('option', { name: '全组' })).toBeInTheDocument()
  })

  it('adds the admin as an option when their username has no data yet', () => {
    // "lina" (me.username) has no facets people entry — only other people show up.
    const peopleWithoutSelf = [{ value: 'wang', n: 1 }]
    render(
      <PersonPicker
        me={me('admin')}
        people={peopleWithoutSelf}
        value="lina"
        onChange={vi.fn()}
        allowAll
      />
    )
    const select = screen.getByRole('combobox') as HTMLSelectElement
    // "lina" (me.username) is not in `people`; the displayed option must still match the query.
    expect(select.value).toBe('lina')
    expect(screen.getByRole('option', { name: '我（lina）' })).toBeInTheDocument()
  })

  it('does not duplicate the admin when they already have data', () => {
    render(
      <PersonPicker
        me={me('admin')}
        people={[{ value: 'lina', n: 1 }]}
        value="lina"
        onChange={vi.fn()}
      />
    )
    expect(screen.queryByRole('option', { name: '我（lina）' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('option', { name: 'lina' })).toHaveLength(1)
  })

  it('calls onChange with the picked username', async () => {
    const onChange = vi.fn()
    render(
      <PersonPicker me={me('admin')} people={people} value="lina" onChange={onChange} allowAll />
    )
    await userEvent.setup().selectOptions(screen.getByRole('combobox'), 'wang')
    expect(onChange).toHaveBeenCalledWith('wang')
  })
})

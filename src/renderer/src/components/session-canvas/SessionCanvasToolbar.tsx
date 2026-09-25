import React from 'react'
import { ChevronDown, LayoutGrid, Maximize } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import {
  SESSION_CANVAS_FILTER_STATES,
  sessionCanvasOtherGroupLabel,
  sessionCanvasStateLabel
} from './session-canvas-labels'
import { SESSION_CANVAS_OTHER_GROUP_ID } from './session-graph-membership-model'
import type { SessionCanvasFilters } from './session-graph-types'
import type { SessionCanvasProjectOption } from './use-session-canvas-data'

const HOUR_MS = 60 * 60 * 1000
const HIDE_IDLE_HOURS = ['1', '6', '12', '24', '72'] as const
const HIDE_IDLE_OFF = 'off'

function toggleValue(values: string[], value: string, checked: boolean): string[] {
  return checked ? [...values, value] : values.filter((candidate) => candidate !== value)
}

function MultiFilterMenu(props: {
  label: string
  options: readonly string[]
  selected: string[]
  optionLabel: (value: string) => string
  onChange: (next: string[]) => void
}): React.JSX.Element {
  const count = props.selected.length
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          {count > 0 ? `${props.label} · ${count}` : props.label}
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {props.options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option}
            checked={props.selected.includes(option)}
            // Keep the menu open so several values can be toggled in one go.
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) =>
              props.onChange(toggleValue(props.selected, option, checked === true))
            }
          >
            {props.optionLabel(option)}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function SessionCanvasToolbar(props: {
  filters: SessionCanvasFilters
  onFiltersChange: (next: SessionCanvasFilters) => void
  agentOptions: string[]
  projectOptions: SessionCanvasProjectOption[]
  onResetLayout: () => void
  onFitView: () => void
}): React.JSX.Element {
  const { filters, onFiltersChange } = props
  const projectLabels = new Map(props.projectOptions.map((option) => [option.id, option.label]))
  // Keep picked projects listed even after their sessions leave, so they can be unticked.
  const projectIds = [...new Set([...projectLabels.keys(), ...filters.projects])]
  const projectLabel = (id: string): string =>
    id === SESSION_CANVAS_OTHER_GROUP_ID
      ? sessionCanvasOtherGroupLabel()
      : (projectLabels.get(id) ?? id.replace(/^group:/, ''))
  const hideIdleValue =
    filters.hideIdleOlderThanMs === null
      ? HIDE_IDLE_OFF
      : String(Math.round(filters.hideIdleOlderThanMs / HOUR_MS))
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
      <div className="w-56">
        <Input
          type="search"
          value={filters.query}
          onChange={(event) => onFiltersChange({ ...filters, query: event.target.value })}
          placeholder={translate('sessionCanvas.toolbar.search', '搜索会话')}
          aria-label={translate('sessionCanvas.toolbar.search', '搜索会话')}
        />
      </div>
      <MultiFilterMenu
        label={translate('sessionCanvas.toolbar.project', '项目')}
        options={projectIds}
        selected={filters.projects}
        optionLabel={projectLabel}
        onChange={(projects) => onFiltersChange({ ...filters, projects })}
      />
      <MultiFilterMenu
        label={translate('sessionCanvas.toolbar.agent', 'Agent')}
        options={props.agentOptions}
        selected={filters.agents}
        optionLabel={(agent) => agent}
        onChange={(agents) => onFiltersChange({ ...filters, agents })}
      />
      <MultiFilterMenu
        label={translate('sessionCanvas.toolbar.state', '状态')}
        options={SESSION_CANVAS_FILTER_STATES}
        selected={filters.states}
        optionLabel={sessionCanvasStateLabel}
        onChange={(states) => onFiltersChange({ ...filters, states })}
      />
      <div className="flex items-center gap-1.5">
        <Switch
          id="session-canvas-show-external"
          checked={filters.showExternal}
          onCheckedChange={(showExternal) => onFiltersChange({ ...filters, showExternal })}
        />
        <Label htmlFor="session-canvas-show-external">
          {translate('sessionCanvas.toolbar.showExternal', '显示外部会话')}
        </Label>
      </div>
      <Select
        value={hideIdleValue}
        onValueChange={(value) =>
          onFiltersChange({
            ...filters,
            hideIdleOlderThanMs: value === HIDE_IDLE_OFF ? null : Number(value) * HOUR_MS
          })
        }
      >
        <SelectTrigger
          size="sm"
          aria-label={translate('sessionCanvas.toolbar.hideIdle', '隐藏空闲会话')}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={HIDE_IDLE_OFF}>
            {translate('sessionCanvas.toolbar.hideIdleOff', '显示全部空闲会话')}
          </SelectItem>
          {HIDE_IDLE_HOURS.map((hours) => (
            <SelectItem key={hours} value={hours}>
              {translate('sessionCanvas.toolbar.hideIdleHours', '隐藏空闲超过 {{hours}} 小时', {
                hours
              })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="ml-auto flex items-center gap-1">
        <Button variant="outline" size="sm" onClick={props.onResetLayout}>
          <LayoutGrid />
          {translate('sessionCanvas.toolbar.resetLayout', '重新排列')}
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={props.onFitView}
              aria-label={translate('sessionCanvas.toolbar.fitView', '适应视图')}
            >
              <Maximize />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            {translate('sessionCanvas.toolbar.fitView', '适应视图')}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

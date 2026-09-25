import { describe, expect, it } from 'vitest'
import { describeSessionCanvasRefusal } from './session-canvas-refusal-model'

describe('describeSessionCanvasRefusal', () => {
  it('maps known terminal and orchestration refusal codes to Chinese', () => {
    expect(describeSessionCanvasRefusal('agent_prompt_blocked')).toBe(
      '会话正在等你审批权限，先处理审批再发送。'
    )
    expect(describeSessionCanvasRefusal('terminal_not_writable')).toBe(
      '终端当前不接受输入，可能已退出或被锁定。'
    )
    expect(describeSessionCanvasRefusal('no-agent')).toBe('这个终端里没有在运行的智能体。')
    expect(describeSessionCanvasRefusal(' terminal_tab_pinned ')).toBe(
      '标签已固定，不能从画布关闭。'
    )
  })

  it('passes unknown reasons through unchanged', () => {
    expect(describeSessionCanvasRefusal('找不到会话')).toBe('找不到会话')
    expect(describeSessionCanvasRefusal('Worker exited before ready')).toBe(
      'Worker exited before ready'
    )
  })
})

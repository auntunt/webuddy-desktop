import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

// Why: the canvas reads the collector's pass-along log under WEBUDDY_AGENT_HOME; never the user's.
const agentHome = mkdtempSync(path.join(os.tmpdir(), 'webuddy-agent-home-e2e-'))
test.use({ orcaAppExtraEnv: { WEBUDDY_AGENT_HOME: agentHome, ORCA_BACKGROUND_LAUNCH: '1' } })
test.afterAll(() => rmSync(agentHome, { recursive: true, force: true }))

async function shot(page: Page, name: string, outputPath: (name: string) => string): Promise<void> {
  // Why: menus and dialogs fade/zoom in; capture the settled frame, skipping infinite spinners.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined))
    )
  )
  // Opt-in copy for design review; the test output dir always gets one.
  const reviewDir = process.env.SESSION_CANVAS_SHOT_DIR
  if (reviewDir) {
    mkdirSync(reviewDir, { recursive: true })
    await page.screenshot({ path: path.join(reviewDir, name) })
  }
  await page.screenshot({ path: outputPath(name) })
}

/** Seeds two agent sessions through the store (no real agent CLI in the isolated profile). */
async function seedLiveSessions(page: Page, worktreeId: string): Promise<[string, string]> {
  return page.evaluate((worktreeId): [string, string] => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is unavailable')
    }
    const tab =
      store.getState().tabsByWorktree[worktreeId]?.[0] ??
      store.getState().createTab(worktreeId, undefined, undefined, {
        activate: false,
        id: 'session-canvas-e2e-tab'
      })
    const seeds = [
      { leaf: '00000000-0000-4000-8000-00000000000a', title: '协调者', state: 'done' as const },
      { leaf: '00000000-0000-4000-8000-00000000000b', title: '工人', state: 'working' as const }
    ]
    const paneKeys = seeds.map(({ leaf, title, state }, index) => {
      const paneKey = `${tab.id}:${leaf}`
      store.getState().setAgentStatus(
        paneKey,
        {
          state,
          prompt: `${title}的任务`,
          agentType: 'claude',
          lastAssistantMessage: index === 0 ? '登录测试已全部通过。' : undefined
        },
        title,
        undefined,
        { tabId: tab.id, terminalHandle: `session-canvas-e2e-${index}`, worktreeId }
      )
      return paneKey
    })
    return [paneKeys[0], paneKeys[1]]
  }, worktreeId)
}

test('session canvas: empty canvas, live cards and the drag-to-connect menu', async ({
  orcaPage
}, testInfo) => {
  const outputPath = (name: string): string => testInfo.outputPath(name)
  await waitForSessionReady(orcaPage)
  const worktreeId = await waitForActiveWorktree(orcaPage)

  await orcaPage.getByRole('button', { name: '会话画布' }).click()
  await expect(orcaPage.getByRole('heading', { name: '会话画布' })).toBeVisible()
  await expect(orcaPage.getByText(/还没有会话/)).toBeVisible()
  await shot(orcaPage, '1-empty-canvas.png', outputPath)

  const [fromKey, toKey] = await seedLiveSessions(orcaPage, worktreeId)
  const liveCards = orcaPage.getByTestId('session-live-card')
  await expect(liveCards).toHaveCount(2)
  await orcaPage.getByRole('button', { name: '适应视图' }).click()
  // fitView animates for 200 ms.
  await expect(liveCards.first()).toBeInViewport()
  await shot(orcaPage, '2-live-cards.png', outputPath)

  const source = orcaPage.locator(
    `.react-flow__node[data-id="live:${fromKey}"] .react-flow__handle.source`
  )
  const target = orcaPage.locator(
    `.react-flow__node[data-id="live:${toKey}"] .react-flow__handle.target`
  )
  const from = await source.boundingBox()
  const to = await target.boundingBox()
  if (!from || !to) {
    throw new Error('connection handles are not laid out')
  }
  await orcaPage.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await orcaPage.mouse.down()
  await orcaPage.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 })
  await orcaPage.mouse.up()

  const menu = orcaPage.getByRole('menu')
  await expect(menu.getByRole('menuitem', { name: /传话/ })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /监督/ })).toBeVisible()
  await shot(orcaPage, '3-connect-menu.png', outputPath)

  await menu.getByRole('menuitem', { name: /传话/ }).click()
  const dialog = orcaPage.getByRole('dialog')
  await dialog.getByRole('textbox', { name: '附言（可选）' }).fill('请据此继续修复。')
  await expect(dialog.getByTestId('pass-along-preview')).toContainText('来自〈协调者〉的结果：')
  await expect(dialog.getByTestId('pass-along-preview')).toContainText('登录测试已全部通过。')
  await shot(orcaPage, '4-pass-along-dialog.png', outputPath)
  await orcaPage.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

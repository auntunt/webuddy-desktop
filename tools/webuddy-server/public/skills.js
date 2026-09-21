/* Skill 库视图：按人看提炼结果，可单条或整包下载。 */

function currentSkillUser() {
  const select = $('s-user')
  const value = select.classList.contains('hide') ? '' : select.value
  // 下拉还没填好时（首屏直接落在 #skills）回退到自己。
  return value || ME.username
}

function renderSkills(items) {
  if (!items.length) {
    $('s-list').innerHTML = `<div class="empty">还没有提炼结果<br>
      <span class="dim">点「立即提炼」跑一次；每 6 小时也会自动跑，且只在有新会话时才调模型</span></div>`
    return
  }
  $('s-list').innerHTML = `<div class="grid g2">${items
    .map(
      (s) => `
    <div class="card" style="background:var(--surface2)">
      <div class="row" style="align-items:flex-start">
        <div style="flex:1">
          <div style="font-weight:600;font-size:14px">${esc(s.title)}</div>
          <div class="dim small" style="margin-top:4px">${esc(s.summary ?? '')}</div>
        </div>
        <a class="pill brand" href="/api/skills/${s.id}/download?${qs()}" download>下载</a>
      </div>
      <div class="row" style="margin-top:10px;gap:6px">
        ${(s.tags || []).map((t) => `<span class="pill">${esc(t)}</span>`).join('')}
      </div>
      <div class="dim small" style="margin-top:8px">
        来自 ${fmtNum(s.source_sessions)} 个会话 · ${fmtDate(s.created_at)} · ${esc(s.model ?? '')}
      </div>
    </div>`
    )
    .join('')}</div>`
}

async function loadSkills() {
  const user = currentSkillUser()
  $('s-list').innerHTML = '<div class="empty">加载中…</div>'
  try {
    const data = await api(`/api/skills?user=${encodeURIComponent(user)}`)
    renderSkills(data.items)
    $('s-bundle').href = `/api/skills/bundle?user=${encodeURIComponent(user)}&${qs()}`
    $('s-bundle').textContent = `下载整包（${data.items.length} 条）`
  } catch (error) {
    $('s-list').innerHTML = `<div class="empty">${esc(error.message)}</div>`
  }
}

async function refreshSkillUsers() {
  await fillUserPicker('s-user', () => loadSkills())
}

$('s-refresh').onclick = loadSkills
$('s-extract').onclick = async () => {
  const button = $('s-extract')
  button.disabled = true
  $('s-msg').className = 'msg'
  $('s-msg').textContent = '提炼中，可能要一两分钟…'
  try {
    // 提炼是"当前登录人"的动作；管理员要提炼别人，用对方的账号跑更符合归属语义。
    const result = await api('/api/skills/extract', { method: 'POST' })
    if (result.skipped) {
      $('s-msg').className = 'msg'
      $('s-msg').textContent =
        `跳过：${result.skipped === 'no-new-data' ? '没有新数据，不浪费 token' : result.skipped}`
    } else {
      $('s-msg').className = 'msg ok'
      $('s-msg').textContent =
        `提炼出 ${result.extracted} 条（${fmtNum(result.inputTokens)}+${fmtNum(result.outputTokens)} tokens）`
    }
    await loadSkills()
  } catch (error) {
    $('s-msg').className = 'msg bad'
    $('s-msg').textContent = error.message
  } finally {
    button.disabled = false
  }
}

document.addEventListener('webuddy:ready', () => {
  void refreshSkillUsers()
})

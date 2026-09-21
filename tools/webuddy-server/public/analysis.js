/* AI 分析视图。内容由模型产出，这里只负责取回与展示。 */

/** 极简 markdown：标题、粗体、列表。够用即可，不为了渲染引库。 */
function renderMarkdown(text) {
  return esc(text)
    .replace(/^### (.+)$/gm, '<div style="font-weight:600;margin:14px 0 4px">$1</div>')
    .replace(
      /^## (.+)$/gm,
      '<div style="font-weight:650;font-size:14.5px;margin:18px 0 6px">$1</div>'
    )
    .replace(/^# (.+)$/gm, '<div style="font-weight:650;font-size:16px;margin:18px 0 6px">$1</div>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="mono">$1</code>')
    .replace(/^- (.+)$/gm, '<div style="padding-left:14px;position:relative">· $1</div>')
    .replace(/\n{2,}/g, '<div style="height:8px"></div>')
}

/** 管理员可以看别人的分析；成员只有自己，下拉就不显示。 */
async function fillUserPicker(selectId, onChange) {
  const select = $(selectId)
  if (!ME || ME.role !== 'admin') {
    select.classList.add('hide')
    select.innerHTML = `<option value="${esc(ME?.username ?? '')}">${esc(ME?.username ?? '')}</option>`
    return ME?.username ?? ''
  }
  try {
    const facets = await api('/api/facets')
    select.innerHTML = `<option value="__all__">全组</option>${facets.people
      .map((p) => `<option value="${esc(p.value)}">${esc(p.value)}</option>`)
      .join('')}`
    select.value = ME.username
  } catch {
    select.innerHTML = `<option value="${esc(ME.username)}">${esc(ME.username)}</option>`
  }
  select.onchange = onChange
  return select.value
}

function currentAnalysisUser() {
  const select = $('a-user')
  const value = select.classList.contains('hide') ? '' : select.value
  // 下拉还没填好时（首屏直接落在 #analysis）回退到自己，避免用空值去查。
  return value || ME.username
}

async function loadAnalysis() {
  const user = currentAnalysisUser()
  $('a-body').innerHTML = '<div class="empty">加载中…</div>'
  try {
    const q = user === '__all__' ? 'user=__all__' : `user=${encodeURIComponent(user)}`
    const data = await api(`/api/analysis/llm?${q}`)
    if (!data.content) {
      $('a-meta').textContent = ''
      $('a-body').innerHTML =
        `<div class="empty">还没有分析结果<br><span class="dim">点「立即分析」跑一次，或等定时任务（每 2 小时，无新数据会自动跳过）</span></div>`
      return
    }
    $('a-meta').textContent =
      `${data.model} · ${fmtDate(data.createdAt)} · 覆盖 ${fmtNum(data.sessionsCovered)} 会话 · ${fmtNum(data.inputTokens)}+${fmtNum(data.outputTokens)} tokens`
    $('a-body').innerHTML =
      `<div style="font-size:13.5px;line-height:1.85">${renderMarkdown(data.content)}</div>`
  } catch (error) {
    $('a-body').innerHTML = `<div class="empty">${esc(error.message)}</div>`
  }
}

$('a-refresh').onclick = loadAnalysis
$('a-run').onclick = async () => {
  const button = $('a-run')
  button.disabled = true
  $('a-msg').className = 'msg'
  $('a-msg').textContent = '分析中，可能要几十秒…'
  try {
    const result = await api('/api/analysis/llm/run', { method: 'POST' })
    $('a-msg').className = result.skipped ? 'msg' : 'msg ok'
    $('a-msg').textContent = result.skipped
      ? `跳过：${result.skipped === 'no-new-data' ? '没有新数据，不浪费 token' : result.skipped}`
      : `完成：${fmtNum(result.inputTokens)}+${fmtNum(result.outputTokens)} tokens`
    await loadAnalysis()
  } catch (error) {
    $('a-msg').className = 'msg bad'
    $('a-msg').textContent = error.message
  } finally {
    button.disabled = false
  }
}

// 登录完成后才有人可选，所以等 app.js 的事件再填下拉。
document.addEventListener('webuddy:ready', () => {
  void fillUserPicker('a-user', () => loadAnalysis())
})

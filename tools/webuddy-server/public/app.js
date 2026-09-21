/* 数据总览 + 登录。用户管理在 admin.js。 */

const $ = (id) => document.getElementById(id)
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  )
const fmtNum = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('zh-CN'))
const fmtDur = (ms) => {
  if (!ms) {
    return '—'
  }
  const h = Math.floor(ms / 3600000),
    m = Math.round((ms % 3600000) / 60000)
  return h ? `${h} 小时 ${m} 分` : `${m} 分`
}
const shortPath = (p) =>
  String(p ?? '')
    .replace(/^~/, '')
    .split('/')
    .filter(Boolean)
    .slice(-2)
    .join('/') || '—'
const initials = (name) =>
  String(name ?? '?')
    .trim()
    .slice(0, 1)
    .toUpperCase()

const URL_TOKEN = new URLSearchParams(location.search).get('token') || ''
let TOKEN = URL_TOKEN || localStorage.getItem('webuddy.token') || ''
if (URL_TOKEN) {
  localStorage.setItem('webuddy.token', URL_TOKEN)
}
let ME = null

function filters() {
  return {
    user: $('f-user').value,
    agent: $('f-agent').value,
    from: $('f-from').value,
    to: $('f-to').value,
    q: $('f-q').value.trim()
  }
}
function qs() {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(filters())) {
    if (v) {
      p.set(k, v)
    }
  }
  if (TOKEN) {
    p.set('token', TOKEN)
  }
  return p.toString()
}
async function api(path, options) {
  const res = await fetch(`${path}${path.includes('?') ? '&' : '?'}${qs()}`, options)
  if (res.status === 401) {
    showLogin('登录已失效，请重新登录')
    throw new Error('未登录')
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(body.error || `${res.status} ${res.statusText}`)
  }
  return body
}

function showLogin(message) {
  $('login').classList.remove('hide')
  $('l-err').textContent = message || ''
}

// 每个视图自己的加载函数；新增视图只在这里登记一行。
const VIEW_LOADERS = {
  users: () => loadUsers(),
  analysis: () => loadAnalysis(),
  skills: () => loadSkills()
}

function switchView(name) {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.classList.toggle('on', tab.dataset.view === name)
  }
  for (const view of document.querySelectorAll('.view')) {
    view.classList.toggle('on', view.id === `view-${name}`)
  }
  // Kept in the hash so a view is linkable and survives a reload.
  history.replaceState(null, '', name === 'data' ? location.pathname : `#${name}`)
  VIEW_LOADERS[name]?.()
}

function renderKpis(t) {
  const items = [
    ['会话数', fmtNum(t.sessions)],
    ['人数', fmtNum(t.people)],
    ['人类轮次', fmtNum(t.turns)],
    ['消息数', fmtNum(t.messages)],
    ['累计时长', fmtDur(t.duration_ms)]
  ]
  $('kpis').innerHTML = items
    .map(
      ([k, v]) => `<div class="card kpi"><div class="k">${k}</div><div class="v">${v}</div></div>`
    )
    .join('')
}
function renderBars(el, rows, label) {
  if (!rows.length) {
    el.innerHTML = '<div class="empty">没有数据</div>'
    return
  }
  const max = Math.max(...rows.map((r) => Number(r.sessions) || 0), 1)
  el.innerHTML = rows
    .map((r) => {
      const v = Number(r.sessions) || 0
      return `<div class="bar" title="${esc(r.key ?? '')}"><span class="lab">${esc(label(r))}</span>
      <span class="track"><span class="fill" style="width:${Math.max(2, Math.round((v / max) * 100))}%"></span></span>
      <span class="num">${fmtNum(v)}</span></div>`
    })
    .join('')
}
function renderRows(items) {
  if (!items.length) {
    $('rows').innerHTML = '<div class="empty">没有数据</div>'
    return
  }
  $('rows').innerHTML = `<div class="tw"><table><thead><tr>
    <th>日期</th><th>人</th><th>agent</th><th>模型</th><th>轮次</th><th>时长</th><th>项目</th><th>分支</th><th>正文</th>
    </tr></thead><tbody>${items
      .map(
        (s, i) => `<tr class="clickable" data-i="${i}">
      <td class="mono">${esc(s.local_date)}</td>
      <td><span class="row"><span class="avatar">${esc(initials(s.user_id))}</span>${esc(s.user_id)}</span></td>
      <td><span class="pill">${esc(s.agent_label || s.agent_id)}</span></td>
      <td class="mono dim">${esc(s.agent_model || '—')}</td>
      <td class="mono">${fmtNum(s.turn_count)}</td><td class="mono dim">${fmtDur(s.duration_ms)}</td>
      <td class="mono" title="${esc(s.cwd)}">${esc(shortPath(s.cwd))}</td>
      <td class="mono dim">${esc(s.branch || '—')}</td>
      <td>${s.transcript_truncated ? '<span class="pill warn">截断</span>' : '<span class="pill ok">完整</span>'}</td>
    </tr>`
      )
      .join('')}</tbody></table></div>`
  $('rows')
    .querySelectorAll('tbody tr')
    .forEach((tr) => {
      tr.onclick = () => openSession(items[Number(tr.dataset.i)])
    })
}

async function openSession(row) {
  $('drawer').classList.add('on')
  $('d-title').textContent = `${row.local_date} · ${row.user_id} · ${row.agent_id}`
  $('d-body').innerHTML = '<div class="empty">加载中…</div>'
  try {
    const s = await api(`/api/sessions/${encodeURIComponent(row.dedupe_key)}`)
    const meta = [
      ['人员', s.user_id],
      ['设备', s.device_label || s.hostname],
      ['agent', `${s.agent_label || s.agent_id} ${s.agent_version || ''}`],
      ['模型', s.agent_model],
      ['会话 id', s.session_id],
      ['开始', s.started_at],
      ['结束', s.ended_at],
      ['轮次 / 消息', `${s.turn_count} / ${s.message_count}`],
      ['token', s.tokens_total],
      ['项目', s.cwd],
      ['分支', s.branch],
      ['正文指纹', s.transcript_sha256],
      ['脱敏规则', s.redaction_rules || '（无命中）'],
      ['接收时间', s.received_at]
    ]
    $('d-body').innerHTML = `<div class="tw" style="margin-bottom:16px"><table>${meta
      .map(
        ([k, v]) =>
          `<tr><td class="dim" style="width:120px">${k}</td><td class="mono">${esc(v ?? '—')}</td></tr>`
      )
      .join('')}</table></div>
      <h2>会话正文（已脱敏）</h2>${s.transcript_body ? `<pre>${esc(s.transcript_body)}</pre>` : '<div class="empty">这次会话没有正文</div>'}`
  } catch (error) {
    $('d-body').innerHTML = `<div class="empty">加载失败：${esc(error.message)}</div>`
  }
}

async function loadFacets() {
  try {
    const f = await api('/api/facets')
    $('f-user').innerHTML = `<option value="">全部人员</option>${f.people
      .map((p) => `<option value="${esc(p.value)}">${esc(p.value)} (${p.n})</option>`)
      .join('')}`
    $('f-agent').innerHTML = `<option value="">全部 agent</option>${f.agents
      .map((a) => `<option value="${esc(a.value)}">${esc(a.value)} (${a.n})</option>`)
      .join('')}`
  } catch {
    /* filters are optional */
  }
}

async function load() {
  for (const id of ['c-day', 'c-agent', 'c-person', 'c-project']) {
    $(id).innerHTML = '<div class="empty">加载中…</div>'
  }
  try {
    const [byDay, byAgent, byPerson, byProject, list] = await Promise.all([
      api('/api/stats?group=day'),
      api('/api/stats?group=agent'),
      api('/api/stats?group=person'),
      api('/api/stats?group=project'),
      api('/api/sessions?limit=200')
    ])
    renderKpis(byDay.totals)
    renderBars($('c-day'), [...byDay.groups].toReversed(), (r) => r.key)
    renderBars($('c-agent'), byAgent.groups, (r) => r.key)
    renderBars($('c-person'), byPerson.groups, (r) => r.key)
    renderBars($('c-project'), byProject.groups, (r) => shortPath(r.key))
    renderRows(list.items)
  } catch (error) {
    $('c-day').innerHTML = `<div class="empty">${esc(error.message)}</div>`
  }
}

function download(kind) {
  const a = document.createElement('a')
  a.href = `/api/export.${kind}?${qs()}`
  document.body.appendChild(a)
  a.click()
  a.remove()
}

async function startApp() {
  try {
    const me = await api('/api/auth/me')
    ME = me.user
    $('who').innerHTML =
      `<span class="avatar">${esc(initials(ME.display_name || ME.username))}</span>
      ${esc(ME.display_name || ME.username)} · ${ME.role === 'admin' ? '管理员' : '成员'}`
    $('tab-users').classList.toggle('hide', ME.role !== 'admin')
    $('login').classList.add('hide')
    loadFacets()
    load()
    // Why an event: the per-view scripts load after this file, so they need a
    // signal that login resolved rather than polling a global.
    window.WEBUDDY_ME = ME
    document.dispatchEvent(new Event('webuddy:ready'))
    const initial = location.hash.replace('#', '')
    if (initial && initial !== 'data') {
      switchView(initial)
    }
    return true
  } catch {
    return false
  }
}

document.querySelectorAll('.tab').forEach((t) => {
  t.onclick = () => switchView(t.dataset.view)
})
$('apply').onclick = load
$('csv').onclick = () => download('csv')
$('json').onclick = () => download('json')
$('clear').onclick = () => {
  ;['f-user', 'f-agent', 'f-from', 'f-to', 'f-q'].forEach((id) => {
    $(id).value = ''
  })
  load()
}
$('d-close').onclick = () => $('drawer').classList.remove('on')
$('logout').onclick = () => {
  localStorage.removeItem('webuddy.token')
  location.reload()
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    $('drawer').classList.remove('on')
  }
})

$('login-form').onsubmit = async (event) => {
  event.preventDefault()
  $('l-err').textContent = ''
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: $('l-user').value.trim(),
        password: $('l-pass').value,
        label: 'dashboard'
      })
    })
    if (!res.ok) {
      $('l-err').textContent = '用户名或密码不对'
      return
    }
    TOKEN = (await res.json()).token
    localStorage.setItem('webuddy.token', TOKEN)
    startApp()
  } catch (error) {
    $('l-err').textContent = String(error.message || error)
  }
}

setInterval(() => {
  if ($('login').classList.contains('hide') && $('view-data').classList.contains('on')) {
    load()
  }
}, 60000)
startApp()

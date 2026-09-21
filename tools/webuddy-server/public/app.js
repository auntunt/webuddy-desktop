/* 数据总览 + 登录。用户管理在 admin.js。 */

const $ = (id) => document.getElementById(id)
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  )
const fmtNum = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('zh-CN'))
/**
 * 显式挂到 window：admin.js / analysis.js / skills.js 直接调用这些名字。
 * Why 不用 const：oxlint 只看单文件作用域，看不到跨文件调用，会报 no-unused-vars；
 * 之前照它删掉 fmtDate，导致三个 Tab 一点进去就是 "fmtDate is not defined" 全空白。
 * 挂到 window 既表达了"这是共享契约"，也不会再被误删。
 */
window.fmtDate = (s) => (s ? String(s).slice(0, 10) : '—')
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
    project: $('f-project').value,
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
  for (const tab of document.querySelectorAll('.tab[data-view]')) {
    tab.classList.toggle('on', tab.dataset.view === name)
  }
  for (const view of document.querySelectorAll('.view')) {
    view.classList.toggle('on', view.id === `view-${name}`)
  }
  // Kept in the hash so a view is linkable and survives a reload.
  history.replaceState(null, '', name === 'data' ? location.pathname : `#${name}`)
  VIEW_LOADERS[name]?.()
}

/** 指标卡带副行 —— 只有大字看不出"相对什么"，副行才是信息。 */
function renderKpis(o) {
  const cards = [
    ['会话数', fmtNum(o.sessions), `${fmtNum(o.active_days)} 个活跃天 · 日均 ${o.avg_sessions_per_active_day}`],
    ['有效时长', fmtDur(o.duration_ms), o.clamped_sessions
      ? `平均 ${fmtDur(o.avg_duration_per_active_day)}/天 · ${o.clamped_sessions} 个已封顶`
      : `平均 ${fmtDur(o.avg_duration_per_active_day)}/活跃天`],
    ['人类轮次', fmtNum(o.turns), `${fmtNum(o.messages)} 条消息`],
    ['项目数', fmtNum(o.projects), `跨越 ${fmtNum(o.span_days)} 天`],
    ['正文体积', `${(Number(o.bytes ?? 0) / 1073741824).toFixed(2)} GB`, `${fmtNum(o.tokens)} tokens`]
  ]
  $('kpis').innerHTML = cards
    .map(
      ([k, v, s]) =>
        `<div class="card kpi"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`
    )
    .join('')
}
/** 面板默认只显示前 N 条 —— 几十条条形图铺下来没人看得完，也看不出重点。 */
const CHART_TOP = 8

function renderBars(el, rows, label) {
  if (!rows.length) {
    el.innerHTML = '<div class="empty">没有数据</div>'
    return
  }
  const max = Math.max(...rows.map((r) => Number(r.sessions) || 0), 1)
  const expanded = el.dataset.expanded === '1'
  const visible = expanded ? rows : rows.slice(0, CHART_TOP)
  const bars = visible
    .map((r) => {
      const v = Number(r.sessions) || 0
      return `<div class="bar" title="${esc(r.key ?? '')}"><span class="lab">${esc(label(r))}</span>
      <span class="track"><span class="fill" style="width:${Math.max(2, Math.round((v / max) * 100))}%"></span></span>
      <span class="num">${fmtNum(v)}</span></div>`
    })
    .join('')
  // 超出部分给明确入口，而不是静默截断
  const more =
    rows.length > CHART_TOP
      ? `<button class="ghost" style="margin-top:6px;font-size:12px" data-expand>${
          expanded ? '收起' : `展开全部 ${fmtNum(rows.length)} 项`
        }</button>`
      : ''
  el.innerHTML = `<div class="${expanded ? 'bars-scroll' : ''}">${bars}</div>${more}`
  const button = el.querySelector('[data-expand]')
  if (button) {
    button.onclick = () => {
      el.dataset.expanded = expanded ? '0' : '1'
      renderBars(el, rows, label)
    }
  }
}
function renderRows(items) {
  if (!items.length) {
    // 空表要能区分"这个人没数据"和"系统坏了" —— 否则只能靠猜。
    const who = filters().user
    $('rows').innerHTML = `<div class="empty">${who ? `「${esc(who)}」名下没有会话记录` : '没有数据'}</div>`
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
  $('drawer-scrim').classList.add('on')
  $('d-title').textContent = `${row.local_date} · ${row.user_id} · ${row.agent_id}`
  $('d-body').innerHTML = '<div class="empty">加载中…</div>'
  try {
    const s = await api(`/api/sessions/${encodeURIComponent(row.dedupe_key)}`)
    // 分组呈现：只有把「谁/何时/什么/证据」分开，一屏才扫得完。
    const groups = [
      ['身份', [['人员', s.user_id], ['设备', s.device_label || s.hostname], ['agent', `${s.agent_label || s.agent_id} ${s.agent_version || ''}`], ['模型', s.agent_model]]],
      ['时间', [['日期', s.local_date], ['开始', s.started_at], ['结束', s.ended_at], ['接收', s.received_at]]],
      ['规模', [['轮次 / 消息', `${s.turn_count} / ${s.message_count}`], ['token', s.tokens_total], ['正文体积', `${Math.round((s.transcript_bytes ?? 0) / 1024)} KB`]]],
      ['位置', [['项目', s.cwd], ['分支', s.branch], ['会话 id', s.session_id]]],
      ['合规', [['脱敏规则', s.redaction_rules || '（无命中）'], ['正文指纹', s.transcript_sha256], ['是否截断', s.transcript_truncated ? '是' : '否']]]
    ]
    $('d-body').innerHTML = `<div class="grid g2" style="margin-bottom:18px">${groups
      .map(
        ([title, rows]) =>
          `<div class="card" style="background:#000"><h2>${title}</h2>${rows
            .map(([k, v]) => `<div class="kv"><span class="k">${k}</span><span class="mono">${esc(v ?? '—')}</span></div>`)
            .join('')}</div>`
      )
      .join('')}</div>
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
    // 项目按"最近活跃"倒序 —— 半年前的项目排在最前面没有意义。
    $('f-project').innerHTML = `<option value="">全部项目</option>${(f.projects ?? [])
      .map(
        (p) =>
          `<option value="${esc(p.value)}">${esc(shortPath(p.value))} · ${p.n} 次 · ${esc(p.last_day ?? '')}</option>`
      )
      .join('')}`
    // 人员默认值，优先级：URL 深链 > 已选 > 自己(仅当自己确实有数据) > 全组。
    // Why 要看"自己有没有数据"：admin 这类管理账号名下 0 条会话，默认落在自己身上
    // 就是 KPI 全 0、图表全空 —— 看起来像功能坏了。宁可给全组汇总。
    const urlUser = new URLSearchParams(location.search).get('user')
    const hasOwnData = (f.people ?? []).some((p) => p.value === ME?.username)
    if (urlUser === '__all__') {
      $('f-user').value = ''
    } else if (urlUser) {
      $('f-user').value = urlUser
    } else if (!$('f-user').value) {
      $('f-user').value = hasOwnData ? ME.username : ''
    }
  } catch {
    /* filters are optional */
  }
}

// 分页状态。翻页只重取明细表，不重算图表 —— 图表是按当前筛选的整体口径，与页码无关。
const PAGE = { limit: 50, offset: 0 }

function renderPager(total) {
  const from = total === 0 ? 0 : PAGE.offset + 1
  const to = Math.min(PAGE.offset + PAGE.limit, total)
  const pages = Math.max(1, Math.ceil(total / PAGE.limit))
  const current = Math.floor(PAGE.offset / PAGE.limit) + 1
  $('pager').innerHTML = `
    <span class="dim" style="font-size:12px">
      第 <span class="mono">${from}–${to}</span> 条，共 <span class="mono">${fmtNum(total)}</span> 条
      · 第 ${current} / ${pages} 页
    </span>
    <span class="row">
      <select id="p-size" class="mono">
        ${[20, 50, 100, 200].map((n) => `<option value="${n}"${n === PAGE.limit ? ' selected' : ''}>${n} 条/页</option>`).join('')}
      </select>
      <button id="p-first" ${PAGE.offset === 0 ? 'disabled' : ''}>首页</button>
      <button id="p-prev" ${PAGE.offset === 0 ? 'disabled' : ''}>上一页</button>
      <button id="p-next" ${to >= total ? 'disabled' : ''}>下一页</button>
    </span>`
  $('p-size').onchange = (e) => {
    PAGE.limit = Number(e.target.value)
    PAGE.offset = 0
    loadRows()
  }
  $('p-first').onclick = () => {
    PAGE.offset = 0
    loadRows()
  }
  $('p-prev').onclick = () => {
    PAGE.offset = Math.max(0, PAGE.offset - PAGE.limit)
    loadRows()
  }
  $('p-next').onclick = () => {
    PAGE.offset += PAGE.limit
    loadRows()
  }
}

/** 只刷新明细表 + 翻页器；筛选或翻页都走这里。 */
async function loadRows() {
  // Why 未指定人员就不列明细：一行点开就是一份完整对话正文（含原始项目路径）。
  // 全组混排既看不出归属，也没有隐私边界 —— 汇总图表可以看全组，明细不行。
  if (!filters().user) {
    $('rows').innerHTML =
      '<div class="empty">请先在上方「人员」里选定一位，再查看会话明细<br>' +
      '<span class="dim">全组视图只做汇总统计（指标卡与图表），不列明细</span></div>'
    $('pager').innerHTML = ''
    return
  }
  $('rows').innerHTML = '<div class="empty">加载中…</div>'
  try {
    const data = await api(`/api/sessions?limit=${PAGE.limit}&offset=${PAGE.offset}`)
    renderRows(data.items)
    renderPager(data.total ?? data.items.length)
  } catch (error) {
    $('rows').innerHTML = `<div class="empty">${esc(error.message)}</div>`
  }
}

async function load() {
  for (const id of ['c-day', 'c-agent', 'c-person', 'c-project']) {
    $(id).innerHTML = '<div class="empty">加载中…</div>'
  }
  // 改了筛选条件就回到第一页，否则会停在一个不存在的页码上。
  PAGE.offset = 0
  try {
    const [byDay, byAgent, byPerson, byProject, insights] = await Promise.all([
      // 图表一次性拿全量分组，展开时才是真的"全部"，而不是服务端截断的前 N 条。
      api('/api/stats?group=day&limit=500'),
      api('/api/stats?group=agent&limit=500'),
      api('/api/stats?group=person&limit=500'),
      api('/api/stats?group=project&limit=500'),
      // 指标卡要的活跃天数/封顶数只有 insights 有；顺带拿到更细的口径。
      api(`/api/insights${filters().user ? `?user=${encodeURIComponent(filters().user)}` : ''}`)
    ])
    renderKpis(insights.overall)
    renderBars($('c-day'), [...byDay.groups].toReversed(), (r) => r.key)
    renderBars($('c-agent'), byAgent.groups, (r) => r.key)
    renderBars($('c-person'), byPerson.groups, (r) => r.key)
    renderBars($('c-project'), byProject.groups, (r) => shortPath(r.key))
    await loadRows()
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
    // Why 必须 await：loadFacets 负责把「人员」默认设成你自己，而 load() 会立刻
    // 读这个值去决定是否列明细。并行跑就是竞态 —— 谁先回来不确定，刷新时明细区
    // 时而正常、时而显示"请先选定人员"。
    await loadFacets()
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

document.querySelectorAll('.tab[data-view]').forEach((t) => {
  t.onclick = () => switchView(t.dataset.view)
})
$('apply').onclick = load
$('csv').onclick = () => download('csv')
$('json').onclick = () => download('json')
$('clear').onclick = () => {
  for (const id of ['f-user', 'f-agent', 'f-project', 'f-from', 'f-to', 'f-q']) {
    $(id).value = ''
  }
  for (const tab of document.querySelectorAll('#f-range .tab')) {
    tab.classList.toggle('on', tab.dataset.days === '0')
  }
  load()
}

// 快捷区间：只改 from，保留 to 让用户能自定右边界。
$('f-range').addEventListener('click', (event) => {
  const tab = event.target.closest('.tab')
  if (!tab) {
    return
  }
  for (const other of document.querySelectorAll('#f-range .tab')) {
    other.classList.toggle('on', other === tab)
  }
  const days = Number(tab.dataset.days)
  if (days === 0) {
    $('f-from').value = ''
  } else {
    const from = new Date(Date.now() - days * 86400000)
    $('f-from').value = from.toISOString().slice(0, 10)
  }
  load()
})
function closeDrawer() {
  $('drawer').classList.remove('on')
  $('drawer-scrim').classList.remove('on')
}
$('d-close').onclick = closeDrawer
$('drawer-scrim').onclick = closeDrawer
$('logout').onclick = () => {
  localStorage.removeItem('webuddy.token')
  location.reload()
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeDrawer()
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

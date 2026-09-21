/* 用户管理：建号、改名、调角色、停用、改密、吊销凭证。仅管理员可见。 */

let USERS = []

function showModal(html) {
  $('modal').innerHTML = html
  $('scrim').classList.remove('hide')
}
function closeModal() {
  $('scrim').classList.add('hide')
  $('modal').innerHTML = ''
}

function rolePill(user) {
  return user.role === 'admin'
    ? '<span class="pill brand">管理员</span>'
    : '<span class="pill">成员</span>'
}
function statusPill(user) {
  return user.disabled
    ? '<span class="pill bad">已停用</span>'
    : '<span class="pill ok">正常</span>'
}

function renderUsers() {
  const q = $('u-q').value.trim().toLowerCase()
  const rows = USERS.filter(
    (u) =>
      !q ||
      u.username.toLowerCase().includes(q) ||
      String(u.display_name ?? '')
        .toLowerCase()
        .includes(q)
  )
  if (!rows.length) {
    $('users').innerHTML =
      `<div class="empty">${USERS.length ? '没有匹配的账号' : '还没有账号'}</div>`
    return
  }
  $('users').innerHTML = `<div class="tw"><table><thead><tr>
    <th>用户</th><th>用户名</th><th>角色</th><th>状态</th><th>会话</th><th>最近活跃</th><th>凭证</th><th></th>
    </tr></thead><tbody>${rows
      .map(
        (u) => `<tr>
      <td><span class="row"><span class="avatar">${esc(initials(u.display_name || u.username))}</span>
        ${esc(u.display_name || u.username)}</span></td>
      <td class="mono dim">${esc(u.username)}</td>
      <td>${rolePill(u)}</td>
      <td>${statusPill(u)}</td>
      <td class="mono">${fmtNum(u.session_count)}</td>
      <td class="mono dim">${fmtDate(u.last_active)}</td>
      <td class="mono dim">${u.token_count}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="ghost" data-act="edit" data-id="${u.id}">编辑</button>
        <button class="ghost" data-act="tokens" data-id="${u.id}">凭证</button>
      </td></tr>`
      )
      .join('')}</tbody></table></div>`

  $('users')
    .querySelectorAll('button[data-act]')
    .forEach((btn) => {
      const user = USERS.find((u) => u.id === btn.dataset.id)
      btn.onclick = () => (btn.dataset.act === 'edit' ? editUser(user) : showTokens(user))
    })
}

function editUser(user) {
  const isSelf = ME && ME.id === user.id
  showModal(`
    <h3>编辑 ${esc(user.display_name || user.username)}</h3>
    <p class="sub">用户名 <code class="mono">${esc(user.username)}</code> 不可改 —— 会话记录按它归属。</p>
    <div class="field"><label>显示名</label><input id="e-name" value="${esc(user.display_name ?? '')}"></div>
    <div class="field"><label>角色</label><select id="e-role">
      <option value="member"${user.role === 'member' ? ' selected' : ''}>成员（只能看自己）</option>
      <option value="admin"${user.role === 'admin' ? ' selected' : ''}>管理员（可看全量、管账号）</option>
    </select></div>
    <div class="field"><label>重置密码（留空则不改；改后会吊销该用户所有凭证）</label>
      <input id="e-pass" type="password" placeholder="至少 8 位"></div>
    <div class="field"><label>状态</label><select id="e-disabled"${isSelf ? ' disabled' : ''}>
      <option value="false"${!user.disabled ? ' selected' : ''}>正常</option>
      <option value="true"${user.disabled ? ' selected' : ''}>停用（立即无法上传和登录）</option>
    </select>${isSelf ? '<div class="dim" style="font-size:12px;margin-top:4px">不能停用自己</div>' : ''}</div>
    <div class="row" style="justify-content:flex-end;margin-top:18px">
      <button class="ghost" id="e-cancel">取消</button>
      <button class="primary" id="e-save">保存</button>
    </div>
    <div class="msg" id="e-msg"></div>`)

  $('e-cancel').onclick = closeModal
  $('e-save').onclick = async () => {
    const payload = {
      displayName: $('e-name').value.trim(),
      role: $('e-role').value,
      disabled: $('e-disabled').value === 'true'
    }
    const password = $('e-pass').value
    if (password) {
      payload.password = password
    }
    try {
      await api(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      })
      closeModal()
      loadUsers()
    } catch (error) {
      $('e-msg').className = 'msg bad'
      $('e-msg').textContent = error.message
    }
  }
}

async function showTokens(user) {
  showModal(`<h3>${esc(user.username)} 的凭证</h3>
    <p class="sub">每台设备一个 token。吊销后那台机器需要重新登录。</p>
    <div id="t-list"><div class="empty">加载中…</div></div>
    <div class="row" style="justify-content:flex-end;margin-top:16px"><button class="ghost" id="t-close">关闭</button></div>`)
  $('t-close').onclick = closeModal
  try {
    const { tokens } = await api(`/api/admin/users/${user.id}/tokens`)
    $('t-list').innerHTML = tokens.length
      ? `<div class="tw"><table><thead><tr><th>标签</th><th>创建</th><th>最近使用</th><th></th></tr></thead>
         <tbody>${tokens
           .map(
             (t) => `<tr>
           <td class="mono">${esc(t.label || '—')}</td>
           <td class="mono dim">${fmtDate(t.created_at)}</td>
           <td class="mono dim">${t.last_used_at ? fmtDate(t.last_used_at) : '从未'}</td>
           <td style="text-align:right"><button class="ghost danger" data-token="${t.id}">吊销</button></td>
         </tr>`
           )
           .join('')}</tbody></table></div>`
      : '<div class="empty">没有有效凭证</div>'
    $('t-list')
      .querySelectorAll('button[data-token]')
      .forEach((btn) => {
        btn.onclick = async () => {
          await api(`/api/admin/tokens/${btn.dataset.token}`, { method: 'DELETE' })
          showTokens(user)
        }
      })
  } catch (error) {
    $('t-list').innerHTML = `<div class="empty">${esc(error.message)}</div>`
  }
}

function newUser() {
  showModal(`<h3>新建用户</h3>
    <p class="sub">用户名要和该同事机器上的登录名一致，否则历史记录不会归到他名下。</p>
    <div class="field"><label>用户名</label><input id="n-user" placeholder="例如 liyibin"></div>
    <div class="field"><label>显示名</label><input id="n-name" placeholder="例如 李逸斌"></div>
    <div class="field"><label>初始密码（至少 8 位）</label><input id="n-pass" type="password"></div>
    <div class="field"><label>角色</label><select id="n-role">
      <option value="member">成员</option><option value="admin">管理员</option></select></div>
    <div class="row" style="justify-content:flex-end;margin-top:18px">
      <button class="ghost" id="n-cancel">取消</button><button class="primary" id="n-save">创建</button></div>
    <div class="msg" id="n-msg"></div>`)
  $('n-cancel').onclick = closeModal
  $('n-save').onclick = async () => {
    try {
      await api('/api/admin/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: $('n-user').value.trim(),
          password: $('n-pass').value,
          displayName: $('n-name').value.trim() || $('n-user').value.trim(),
          role: $('n-role').value
        })
      })
      closeModal()
      loadUsers()
    } catch (error) {
      $('n-msg').className = 'msg bad'
      $('n-msg').textContent = error.message
    }
  }
}

async function loadUsers() {
  $('users').innerHTML = '<div class="empty">加载中…</div>'
  try {
    USERS = (await api('/api/admin/users')).users
    renderUsers()
  } catch (error) {
    $('users').innerHTML = `<div class="empty">${esc(error.message)}</div>`
  }
}

$('new-user').onclick = newUser
$('u-refresh').onclick = loadUsers
$('u-q').oninput = renderUsers
$('scrim').onclick = (event) => {
  if (event.target === $('scrim')) {
    closeModal()
  }
}

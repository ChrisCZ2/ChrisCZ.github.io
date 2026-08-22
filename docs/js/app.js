window.TRACKZ_STATIC = /\.github\.io$/i.test(location.hostname);
const PROJECT_COLORS = ['#6d5dfc', '#e57cd8', '#20c997', '#4bc3ff', '#ff8a5b', '#f6c343', '#ef5b5b', '#7c8c9a'];

function page(file) {
  return file;
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function currentUser() {
  try { return JSON.parse(localStorage.getItem('trackz.user') || 'null'); }
  catch { return null; }
}

function loadDb() {
  try {
    return JSON.parse(localStorage.getItem('trackz.db') || 'null') || { projects: [], clients: [], teams: [], entries: [], schedules: [] };
  } catch {
    return { projects: [], clients: [], teams: [], entries: [], schedules: [] };
  }
}

function saveDb(d) {
  d.schedules = d.schedules || [];
  localStorage.setItem('trackz.db', JSON.stringify(d));
}

function staticLogin(provider) {
  const names = { google: 'Google user', github: 'GitHub user', proton: 'Proton user', local: 'My workspace' };
  const existing = currentUser();
  const user = {
    id: existing?.id || localStorage.getItem('trackz.uid') || crypto.randomUUID(),
    name: existing?.name || names[provider] || 'Trackz user',
    email: existing?.email || `${provider}@local`,
    avatar: existing?.avatar || '',
    provider,
    createdAt: existing?.createdAt || new Date().toISOString()
  };
  localStorage.setItem('trackz.uid', user.id);
  localStorage.setItem('trackz.user', JSON.stringify(user));
  return user;
}

function staticApi(url, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  const body = opts.body ? JSON.parse(opts.body) : {};
  const path = url.split('?')[0];
  const user = currentUser();
  const parts = path.split('/').filter(Boolean);

  if (path === '/api/auth/me') return { user };
  if (path === '/api/auth/logout' && method === 'POST') {
    localStorage.removeItem('trackz.user');
    return { ok: true };
  }
  if (path === '/api/health') return { ok: true, app: 'Trackz', static: true };
  if (!user) {
    location.href = page('login.html');
    throw new Error('Unauthorized');
  }

  const d = loadDb();
  d.schedules = d.schedules || [];
  const mine = arr => (arr || []).filter(x => x.userId === user.id);

  if (path === '/api/dashboard') {
    const projects = mine(d.projects);
    const entries = mine(d.entries);
    return {
      projects,
      entries: entries.slice(-8).reverse(),
      totalSeconds: entries.reduce((a, e) => a + (e.running ? 0 : e.duration), 0),
      active: entries.find(e => e.running) || null,
      clients: mine(d.clients),
      teams: mine(d.teams)
    };
  }
  if (path === '/api/projects' && method === 'GET') return mine(d.projects);
  if (path === '/api/projects' && method === 'POST') {
    if (!body.name) throw new Error('Project name required');
    const p = {
      id: crypto.randomUUID(),
      userId: user.id,
      name: body.name,
      client: body.client || '',
      color: body.color || PROJECT_COLORS[d.projects.length % PROJECT_COLORS.length],
      description: body.description || '',
      billable: !!body.billable,
      createdAt: new Date().toISOString(),
      archived: false
    };
    d.projects.push(p);
    saveDb(d);
    return p;
  }
  if (parts[0] === 'api' && parts[1] === 'projects' && parts[2] && method === 'DELETE') {
    d.projects = d.projects.filter(x => !(x.id === parts[2] && x.userId === user.id));
    saveDb(d);
    return { ok: true };
  }
  if (path === '/api/entries' && method === 'GET') return mine(d.entries).reverse();
  if (path === '/api/entries' && method === 'POST') {
    const e = {
      id: crypto.randomUUID(),
      userId: user.id,
      projectId: body.projectId || '',
      description: body.description || 'Manual entry',
      tags: Array.isArray(body.tags) ? body.tags : [],
      billable: !!body.billable,
      startedAt: body.startedAt || new Date().toISOString(),
      duration: Number(body.duration) || 0,
      running: false,
      endedAt: body.endedAt || new Date().toISOString()
    };
    d.entries.push(e);
    saveDb(d);
    return e;
  }
  if (parts[0] === 'api' && parts[1] === 'entries' && parts[2] && method === 'PATCH') {
    const e = d.entries.find(x => x.id === parts[2] && x.userId === user.id);
    if (!e) throw new Error('Not found');
    ['description', 'projectId', 'duration', 'startedAt', 'endedAt', 'tags', 'billable'].forEach(key => {
      if (body[key] !== undefined) e[key] = body[key];
    });
    saveDb(d);
    return e;
  }
  if (parts[0] === 'api' && parts[1] === 'entries' && parts[2] && method === 'DELETE') {
    d.entries = d.entries.filter(x => !(x.id === parts[2] && x.userId === user.id));
    saveDb(d);
    return { ok: true };
  }
  if (path === '/api/timer/start' && method === 'POST') {
    const running = d.entries.find(e => e.userId === user.id && e.running);
    if (running) {
      running.duration = Math.max(1, Math.floor((Date.now() - new Date(running.startedAt).getTime()) / 1000));
      running.endedAt = new Date().toISOString();
      running.running = false;
    }
    const e = {
      id: crypto.randomUUID(),
      userId: user.id,
      projectId: body.projectId || '',
      description: body.description || 'Tracked time',
      tags: Array.isArray(body.tags) ? body.tags : [],
      billable: !!body.billable,
      startedAt: new Date().toISOString(),
      duration: 0,
      running: true
    };
    d.entries.push(e);
    saveDb(d);
    return e;
  }
  if (path === '/api/timer/stop' && method === 'POST') {
    const e = d.entries.find(x => x.userId === user.id && x.running);
    if (!e) throw new Error('No active timer');
    e.duration = Math.max(1, Math.floor((Date.now() - new Date(e.startedAt).getTime()) / 1000));
    e.endedAt = new Date().toISOString();
    e.running = false;
    saveDb(d);
    return e;
  }
  if (path === '/api/clients' && method === 'GET') return mine(d.clients);
  if (path === '/api/clients' && method === 'POST') {
    const c = { id: crypto.randomUUID(), userId: user.id, name: body.name || 'New client', email: body.email || '', createdAt: new Date().toISOString() };
    d.clients.push(c);
    saveDb(d);
    return c;
  }
  if (path === '/api/schedule' && method === 'GET') return mine(d.schedules);
  if (path === '/api/schedule' && method === 'POST') {
    const startAt = body.startAt || new Date().toISOString();
    const duration = Number(body.duration) || 3600;
    const item = {
      id: crypto.randomUUID(),
      userId: user.id,
      projectId: body.projectId || '',
      description: body.description || 'Planned work',
      startAt,
      endAt: body.endAt || new Date(new Date(startAt).getTime() + duration * 1000).toISOString(),
      duration,
      createdAt: new Date().toISOString()
    };
    d.schedules.push(item);
    saveDb(d);
    return item;
  }
  if (parts[0] === 'api' && parts[1] === 'schedule' && parts[2] && method === 'DELETE') {
    d.schedules = d.schedules.filter(x => !(x.id === parts[2] && x.userId === user.id));
    saveDb(d);
    return { ok: true };
  }
  throw new Error('Request failed');
}

async function api(url, opts = {}) {
  if (window.TRACKZ_STATIC) return staticApi(url, opts);
  const r = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts
  });
  let d = {};
  try { d = await r.json(); } catch {}
  if (r.status === 401 && !url.includes('/api/auth/')) {
    location.href = page('login.html');
    throw new Error('Unauthorized');
  }
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
}

async function requireUser() {
  if (window.TRACKZ_STATIC) {
    if (!currentUser()) staticLogin('local');
    return currentUser();
  }
  const d = await api('/api/auth/me');
  if (!d.user) {
    location.href = page('login.html');
    throw new Error('Authentication required');
  }
  return d.user;
}

function fmt(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function hm(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (!h && !m) return '0 min';
  if (!h) return `${m} min`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function dayKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayLabel(key) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = dayKey(new Date());
  const yest = dayKey(new Date(Date.now() - 86400000));
  if (key === today) return 'Today';
  if (key === yest) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

function dayDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function timeRange(start, seconds, running) {
  const a = new Date(start);
  const b = running ? new Date() : (seconds ? new Date(a.getTime() + seconds * 1000) : a);
  const f = d => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${f(a)} – ${f(b)}`;
}

function parseClock(s) {
  const p = String(s || '0').trim().split(':').map(n => Number(n) || 0);
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  if (p.length === 2) return p[0] * 3600 + p[1] * 60;
  return p[0] * 60;
}

function parseDesc(text, projects) {
  const tags = [];
  let projectId = '';
  let description = String(text || '');
  description = description.replace(/#([^\s#]+)/g, (_, t) => {
    tags.push(t);
    return '';
  });
  description = description.replace(/@([^\s@]+)/g, (_, name) => {
    const p = projects.find(x => x.name.toLowerCase().startsWith(name.toLowerCase()));
    if (p) projectId = p.id;
    return '';
  });
  return { description: description.replace(/\s+/g, ' ').trim(), tags, projectId };
}

function allTags(entries) {
  return [...new Set(entries.flatMap(e => e.tags || []))].sort();
}

function projectById(projects, id) {
  return projects.find(p => p.id === id) || null;
}

function projectChip(project) {
  if (!project) return '<span class="chip muted">No project</span>';
  return `<span class="chip"><i class="dot" style="background:${esc(project.color)}"></i>${esc(project.name)}</span>`;
}

function getSettings() {
  try {
    return Object.assign({ group: true, shortcuts: true, calStart: 7, calEnd: 22 }, JSON.parse(localStorage.getItem('trackz.settings') || '{}'));
  } catch {
    return { group: true, shortcuts: true, calStart: 7, calEnd: 20 };
  }
}
function setSettings(part) {
  const next = Object.assign(getSettings(), part);
  localStorage.setItem('trackz.settings', JSON.stringify(next));
  return next;
}

async function saveEntry(id, patch) {
  if (patch.startedAt && patch.duration != null && patch.endedAt == null) {
    patch.endedAt = new Date(new Date(patch.startedAt).getTime() + Number(patch.duration) * 1000).toISOString();
  }
  if (patch.startedAt && patch.endedAt && patch.duration == null) {
    patch.duration = Math.max(0, Math.floor((new Date(patch.endedAt) - new Date(patch.startedAt)) / 1000));
  }
  return api(`/api/entries/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

async function duplicateEntry(e) {
  return api('/api/entries', {
    method: 'POST',
    body: JSON.stringify({
      description: e.description,
      projectId: e.projectId || '',
      tags: e.tags || [],
      billable: !!e.billable,
      startedAt: new Date().toISOString(),
      duration: e.duration || 0
    })
  });
}

async function splitEntry(e, firstSeconds) {
  const total = e.duration || 0;
  if (total < 600) throw new Error('Only entries over 10 minutes can be split');
  const first = Math.min(Math.max(60, firstSeconds || Math.floor(total / 2)), total - 60);
  const start = new Date(e.startedAt);
  await saveEntry(e.id, { duration: first, startedAt: e.startedAt });
  return api('/api/entries', {
    method: 'POST',
    body: JSON.stringify({
      description: e.description,
      projectId: e.projectId || '',
      tags: e.tags || [],
      billable: !!e.billable,
      startedAt: new Date(start.getTime() + first * 1000).toISOString(),
      duration: total - first
    })
  });
}

function showToast(message, actionLabel, onAction) {
  let el = document.querySelector('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.innerHTML = `<span>${esc(message)}</span>${onAction ? `<button type="button">${esc(actionLabel || 'Undo')}</button>` : ''}`;
  el.classList.add('show');
  const btn = el.querySelector('button');
  if (btn) btn.onclick = () => { onAction(); el.classList.remove('show'); };
  clearTimeout(showToast.t);
  showToast.t = setTimeout(() => el.classList.remove('show'), 5000);
}

function toLocalInput(date) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

async function startTimer({ description, projectId, tags, billable } = {}) {
  return api('/api/timer/start', {
    method: 'POST',
    body: JSON.stringify({
      description: (description || '').trim() || 'Tracked time',
      projectId: projectId || '',
      tags: tags || [],
      billable: !!billable
    })
  });
}

async function mountTrackbar() {
  const bar = document.querySelector('#trackbar');
  if (!bar) return { refresh() {} };

  bar.className = 'trackbar';
  bar.innerHTML = `
    <div class="desc-wrap">
      <input id="barDesc" placeholder="What are you working on?" autocomplete="off">
      <div class="suggest hidden" id="suggest"></div>
    </div>
    <div class="project-pick">
      <button type="button" class="project-btn" id="projectBtn">+ Project</button>
      <div class="project-menu hidden" id="projectMenu"></div>
    </div>
    <div class="tag-pick">
      <button type="button" class="ghost-ico" id="tagBtn" title="Tags">#</button>
      <div class="project-menu hidden" id="tagMenu"></div>
    </div>
    <button type="button" class="ghost-ico" id="billableBtn" title="Billable">$</button>
    <input id="barClock" class="clock-input" value="0:00:00" spellcheck="false">
    <div class="mode-switch">
      <button type="button" id="modeTimer" class="on" title="Timer mode">⏱</button>
      <button type="button" id="modeManual" title="Manual mode">＋</button>
    </div>
      <button type="button" class="play" id="barToggle" title="Start timer">▶</button>
    <button type="button" class="ghost-ico" id="discardBtn" title="Discard running entry" hidden>✕</button>`;

  let projects = await api('/api/projects');
  let entries = await api('/api/entries');
  let active = entries.find(e => e.running) || null;
  let projectId = active?.projectId || '';
  let tags = [...(active?.tags || [])];
  let billable = !!active?.billable;
  let mode = 'timer';

  const desc = bar.querySelector('#barDesc');
  const clock = bar.querySelector('#barClock');
  const toggle = bar.querySelector('#barToggle');
  const projectBtn = bar.querySelector('#projectBtn');
  const menu = bar.querySelector('#projectMenu');
  const tagBtn = bar.querySelector('#tagBtn');
  const tagMenu = bar.querySelector('#tagMenu');
  const billableBtn = bar.querySelector('#billableBtn');

  function payloadDesc() {
    const parsed = parseDesc(desc.value, projects);
    return {
      description: parsed.description || desc.value.trim() || 'Tracked time',
      projectId: parsed.projectId || projectId,
      tags: [...new Set([...tags, ...parsed.tags])],
      billable
    };
  }

  function renderMenu() {
    const q = (menu.querySelector('#projectSearch')?.value || '').toLowerCase();
    const list = projects.filter(p => !q || p.name.toLowerCase().includes(q) || (p.client || '').toLowerCase().includes(q));
    menu.innerHTML = `
      <input id="projectSearch" placeholder="Search project" value="${esc(q)}">
      <button type="button" class="menu-item" data-id="">No project</button>
      ${list.map(p => `<button type="button" class="menu-item" data-id="${p.id}"><i class="dot" style="background:${esc(p.color)}"></i>${esc(p.name)}${p.client ? `<small>${esc(p.client)}</small>` : ''}</button>`).join('')}
      <form class="create-project" id="quickProject">
        <input name="name" placeholder="Create a project" required>
        <input name="client" placeholder="Client (optional)">
        <label class="check"><input type="checkbox" name="billable"> Billable by default</label>
        <div class="swatches">${PROJECT_COLORS.map((c, i) => `<button type="button" class="swatch-btn${i ? '' : ' on'}" data-color="${c}" style="background:${c}"></button>`).join('')}</div>
        <button class="btn" type="submit">Create</button>
      </form>`;
    menu.querySelector('#projectSearch').oninput = () => renderMenu();
    const known = allTags(entries);
    tagMenu.innerHTML = `
      ${known.map(t => `<button type="button" class="menu-item${tags.includes(t) ? ' on' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}
      <form class="create-project" id="quickTag"><input name="name" placeholder="Create a tag"><button class="btn" type="submit">Add</button></form>`;
  }

  function syncProjectBtn() {
    const p = projectById(projects, projectId);
    projectBtn.innerHTML = p
      ? `<i class="dot" style="background:${esc(p.color)}"></i><span>${esc(p.name)}</span>`
      : '<span>+ Project</span>';
    tagBtn.classList.toggle('on', tags.length > 0);
    tagBtn.textContent = tags.length ? `#${tags.length}` : '#';
    billableBtn.classList.toggle('on', billable);
  }

  function syncBar() {
    bar.classList.toggle('running', !!active);
    bar.classList.toggle('manual', mode === 'manual');
    if (active) {
      desc.value = active.description;
      projectId = active.projectId || projectId;
      tags = [...(active.tags || [])];
      billable = !!active.billable;
      toggle.textContent = '■';
      toggle.classList.add('stop');
      toggle.title = 'Stop timer';
      clock.readOnly = false;
    } else {
      toggle.textContent = mode === 'manual' ? '✓' : '▶';
      toggle.classList.remove('stop');
      toggle.title = mode === 'manual' ? 'Add time entry' : 'Start timer';
      clock.readOnly = false;
      if (mode === 'timer' && !clock.dataset.dirty) clock.value = '0:00:00';
    }
    bar.querySelector('#discardBtn').hidden = !active;
    bar.querySelector('#modeTimer').classList.toggle('on', mode === 'timer');
    bar.querySelector('#modeManual').classList.toggle('on', mode === 'manual');
    syncProjectBtn();
  }

  function tick() {
    if (active) clock.value = fmt(Math.floor((Date.now() - new Date(active.startedAt).getTime()) / 1000));
    else if (mode === 'timer') clock.value = '0:00:00';
  }

  async function refresh() {
    projects = await api('/api/projects');
    entries = await api('/api/entries');
    active = entries.find(e => e.running) || null;
    renderMenu();
    syncBar();
    tick();
    document.dispatchEvent(new CustomEvent('trackz:refresh'));
  }

  renderMenu();
  syncBar();
  tick();
  setInterval(tick, 500);

  function closeMenus() {
    menu.classList.add('hidden');
    tagMenu.classList.add('hidden');
  }
  projectBtn.onclick = e => {
    e.stopPropagation();
    tagMenu.classList.add('hidden');
    menu.classList.toggle('hidden');
  };
  tagBtn.onclick = e => {
    e.stopPropagation();
    menu.classList.add('hidden');
    tagMenu.classList.toggle('hidden');
  };
  document.addEventListener('click', closeMenus);
  menu.addEventListener('click', e => e.stopPropagation());
  tagMenu.addEventListener('click', e => e.stopPropagation());

  menu.addEventListener('click', async e => {
    const item = e.target.closest('.menu-item');
    if (!item) return;
    projectId = item.dataset.id || '';
    const picked = projectById(projects, projectId);
    if (picked?.billable) billable = true;
    if (active) await api(`/api/entries/${active.id}`, { method: 'PATCH', body: JSON.stringify({ projectId, billable }) });
    closeMenus();
    await refresh();
  });
  menu.addEventListener('click', e => {
    const swatch = e.target.closest('.swatch-btn');
    if (!swatch) return;
    menu.querySelectorAll('.swatch-btn').forEach(b => b.classList.toggle('on', b === swatch));
  });
  menu.addEventListener('submit', async e => {
    if (e.target.id !== 'quickProject') return;
    e.preventDefault();
    const name = e.target.name.value.trim();
    const color = menu.querySelector('.swatch-btn.on')?.dataset.color || PROJECT_COLORS[0];
    if (!name) return;
    const p = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name, color, client: e.target.client.value, billable: e.target.billable.checked }) });
    projectId = p.id;
    if (p.billable) billable = true;
    closeMenus();
    e.target.reset();
    await refresh();
  });

  tagMenu.addEventListener('click', async e => {
    const item = e.target.closest('.menu-item');
    if (!item) return;
    const tag = item.dataset.tag;
    tags = tags.includes(tag) ? tags.filter(t => t !== tag) : [...tags, tag];
    if (active) await api(`/api/entries/${active.id}`, { method: 'PATCH', body: JSON.stringify({ tags }) });
    await refresh();
  });
  tagMenu.addEventListener('submit', async e => {
    if (e.target.id !== 'quickTag') return;
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) return;
    if (!tags.includes(name)) tags.push(name);
    if (active) await api(`/api/entries/${active.id}`, { method: 'PATCH', body: JSON.stringify({ tags }) });
    e.target.reset();
    await refresh();
  });

  billableBtn.onclick = async () => {
    billable = !billable;
    if (active) await api(`/api/entries/${active.id}`, { method: 'PATCH', body: JSON.stringify({ billable }) });
    syncBar();
  };

  bar.querySelector('#modeTimer').onclick = () => { mode = 'timer'; syncBar(); };
  bar.querySelector('#modeManual').onclick = () => { mode = 'manual'; if (!active) clock.value = '1:00:00'; syncBar(); };

  toggle.onclick = async () => {
    const data = payloadDesc();
    if (active) await api('/api/timer/stop', { method: 'POST' });
    else if (mode === 'manual') {
      const duration = parseClock(clock.value);
      const ended = new Date();
      await api('/api/entries', {
        method: 'POST',
        body: JSON.stringify({
          ...data,
          duration,
          endedAt: ended.toISOString(),
          startedAt: new Date(ended.getTime() - duration * 1000).toISOString()
        })
      });
    } else await startTimer(data);
    desc.value = '';
    await refresh();
  };

  desc.addEventListener('keydown', async e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      toggle.click();
    }
  });
  desc.addEventListener('input', () => {
    const q = desc.value.trim().toLowerCase();
    const box = bar.querySelector('#suggest');
    if (!q) { box.classList.add('hidden'); return; }
    const seen = new Set();
    const hits = entries.filter(e => (e.description || '').toLowerCase().includes(q) && seen.has(e.description) === false && seen.add(e.description)).slice(0, 6);
    box.innerHTML = hits.map(e => `<button type="button" data-id="${e.id}">${esc(e.description)}</button>`).join('');
    box.classList.toggle('hidden', !hits.length);
  });
  bar.querySelector('#suggest').addEventListener('mousedown', async e => {
    const btn = e.target.closest('[data-id]');
    if (!btn) return;
    const hit = entries.find(x => x.id === btn.dataset.id);
    if (!hit) return;
    desc.value = hit.description;
    projectId = hit.projectId || '';
    tags = [...(hit.tags || [])];
    billable = !!hit.billable;
    bar.querySelector('#suggest').classList.add('hidden');
    syncBar();
  });

  clock.addEventListener('change', async () => {
    if (!active) return;
    const duration = parseClock(clock.value);
    if (!duration) return;
    await api(`/api/entries/${active.id}`, { method: 'PATCH', body: JSON.stringify({ startedAt: new Date(Date.now() - duration * 1000).toISOString() }) });
    await refresh();
  });

  bar.querySelector('#discardBtn').onclick = async () => {
    if (!active) return;
    const copy = { ...active };
    await api(`/api/entries/${active.id}`, { method: 'DELETE' });
    showToast('Timer discarded', 'Undo', async () => {
      await startTimer(copy);
      await refresh();
    });
    await refresh();
  };

  return {
    refresh,
    getProjectId: () => projectId,
    getDescription: () => desc.value,
    getActive: () => active,
    setMode: next => { mode = next; syncBar(); },
    startNew: async () => {
      mode = 'timer';
      if (!active) await startTimer(payloadDesc());
      await refresh();
    },
    stop: async () => {
      if (active) await api('/api/timer/stop', { method: 'POST' });
      await refresh();
    },
    continueLast: async () => {
      const last = entries.find(e => !e.running);
      if (last) await startTimer(last);
      await refresh();
    },
    startFavorite: async i => {
      document.dispatchEvent(new CustomEvent('trackz:fav', { detail: i }));
    }
  };
}

document.addEventListener('DOMContentLoaded', () => {
  const l = document.querySelector('#logout');
  if (l) {
    l.onclick = async e => {
      e.preventDefault();
      if (window.TRACKZ_STATIC) localStorage.removeItem('trackz.user');
      else await fetch('/api/auth/logout', { method: 'POST' });
      location.href = page('index.html');
    };
  }
});

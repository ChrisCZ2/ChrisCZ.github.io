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
  const names = { google: 'Google user', github: 'GitHub user', proton: 'Proton user' };
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
      startedAt: body.startedAt || new Date().toISOString(),
      duration: Number(body.duration) || 0,
      running: false
    };
    d.entries.push(e);
    saveDb(d);
    return e;
  }
  if (parts[0] === 'api' && parts[1] === 'entries' && parts[2] && method === 'PATCH') {
    const e = d.entries.find(x => x.id === parts[2] && x.userId === user.id);
    if (!e) throw new Error('Not found');
    ['description', 'projectId', 'duration', 'startedAt'].forEach(key => {
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
  const d = await api('/api/auth/me');
  if (!d.user) location.href = page('login.html');
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

function projectById(projects, id) {
  return projects.find(p => p.id === id) || null;
}

function projectChip(project) {
  if (!project) return '<span class="chip muted">No project</span>';
  return `<span class="chip"><i class="dot" style="background:${esc(project.color)}"></i>${esc(project.name)}</span>`;
}

async function startTimer({ description, projectId } = {}) {
  return api('/api/timer/start', {
    method: 'POST',
    body: JSON.stringify({
      description: (description || '').trim() || 'Tracked time',
      projectId: projectId || ''
    })
  });
}

async function mountTrackbar() {
  const bar = document.querySelector('#trackbar');
  if (!bar) return { refresh() {} };

  let projects = await api('/api/projects');
  let entries = await api('/api/entries');
  let active = entries.find(e => e.running) || null;
  let projectId = active?.projectId || '';

  const desc = bar.querySelector('#barDesc');
  const clock = bar.querySelector('#barClock');
  const toggle = bar.querySelector('#barToggle');
  const projectBtn = bar.querySelector('#projectBtn');
  const menu = bar.querySelector('#projectMenu');

  function renderMenu() {
    menu.innerHTML = `
      <button type="button" class="menu-item" data-id="">No project</button>
      ${projects.map(p => `<button type="button" class="menu-item" data-id="${p.id}"><i class="dot" style="background:${esc(p.color)}"></i>${esc(p.name)}</button>`).join('')}
      <form class="create-project" id="quickProject">
        <input name="name" placeholder="Create a project" required>
        <div class="swatches">${PROJECT_COLORS.map((c, i) => `<button type="button" class="swatch-btn${i ? '' : ' on'}" data-color="${c}" style="background:${c}"></button>`).join('')}</div>
        <button class="btn" type="submit">Create</button>
      </form>`;
  }

  function syncProjectBtn() {
    const p = projectById(projects, projectId);
    projectBtn.innerHTML = p
      ? `<i class="dot" style="background:${esc(p.color)}"></i><span>${esc(p.name)}</span>`
      : '<span>+ Project</span>';
  }

  function syncBar() {
    bar.classList.toggle('running', !!active);
    if (active) {
      desc.value = active.description;
      projectId = active.projectId || projectId;
      toggle.textContent = '■';
      toggle.classList.add('stop');
      toggle.title = 'Stop timer';
    } else {
      toggle.textContent = '▶';
      toggle.classList.remove('stop');
      toggle.title = 'Start timer';
    }
    syncProjectBtn();
  }

  function tick() {
    clock.textContent = active ? fmt(Math.floor((Date.now() - new Date(active.startedAt).getTime()) / 1000)) : '0:00:00';
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

  projectBtn.onclick = e => {
    e.stopPropagation();
    menu.classList.toggle('hidden');
  };
  document.addEventListener('click', () => menu.classList.add('hidden'));
  menu.addEventListener('click', e => e.stopPropagation());

  menu.addEventListener('click', async e => {
    const item = e.target.closest('.menu-item');
    if (!item) return;
    projectId = item.dataset.id || '';
    if (active) await api(`/api/entries/${active.id}`, { method: 'PATCH', body: JSON.stringify({ projectId }) });
    menu.classList.add('hidden');
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
    const p = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name, color }) });
    projectId = p.id;
    menu.classList.add('hidden');
    e.target.reset();
    await refresh();
  });

  toggle.onclick = async () => {
    if (active) await api('/api/timer/stop', { method: 'POST' });
    else await startTimer({ description: desc.value, projectId });
    await refresh();
  };

  desc.addEventListener('keydown', async e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!active) await startTimer({ description: desc.value, projectId });
      else await api(`/api/entries/${active.id}`, { method: 'PATCH', body: JSON.stringify({ description: desc.value }) });
      await refresh();
    }
  });

  return { refresh, getProjectId: () => projectId, getDescription: () => desc.value };
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

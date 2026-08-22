window.TRACKZ_STATIC = /\.github\.io$/i.test(location.hostname);

function page(file) {
  return file;
}

function currentUser() {
  try { return JSON.parse(localStorage.getItem('trackz.user') || 'null'); }
  catch { return null; }
}

function loadDb() {
  try {
    return JSON.parse(localStorage.getItem('trackz.db') || 'null') || { projects: [], clients: [], teams: [], entries: [] };
  } catch {
    return { projects: [], clients: [], teams: [], entries: [] };
  }
}

function saveDb(d) {
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
  const mine = arr => arr.filter(x => x.userId === user.id);

  if (path === '/api/dashboard') {
    const projects = mine(d.projects);
    const entries = mine(d.entries);
    return {
      projects,
      entries: entries.slice(-8).reverse(),
      totalSeconds: entries.reduce((a, e) => a + e.duration, 0),
      active: entries.find(e => e.running) || null,
      clients: mine(d.clients),
      teams: mine(d.teams)
    };
  }
  if (path === '/api/projects' && method === 'GET') return mine(d.projects);
  if (path === '/api/projects' && method === 'POST') {
    const p = {
      id: crypto.randomUUID(),
      userId: user.id,
      name: body.name,
      client: body.client || '',
      color: body.color || '#6d5dfc',
      description: body.description || '',
      createdAt: new Date().toISOString(),
      archived: false
    };
    d.projects.push(p);
    saveDb(d);
    return p;
  }
  if (path === '/api/entries' && method === 'GET') return mine(d.entries).reverse();
  if (path === '/api/timer/start' && method === 'POST') {
    if (d.entries.find(e => e.userId === user.id && e.running)) throw new Error('A timer is already running');
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

function fmt(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function hm(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60);
  return `${h}h ${m}m`;
}

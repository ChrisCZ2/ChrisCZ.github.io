(async () => {
  const u = await requireUser();
  await mountTrackbar();
  document.querySelector('#user').textContent = u.name;

  async function load() {
    const [projects, entries] = await Promise.all([api('/api/projects'), api('/api/entries')]);
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    weekStart.setHours(0, 0, 0, 0);
    const today = dayKey(now);
    const tracked = entries.filter(e => !e.running);
    const week = tracked.filter(e => new Date(e.startedAt) >= weekStart);
    const todayEntries = tracked.filter(e => dayKey(e.startedAt) === today);
    const sum = list => list.reduce((a, e) => a + e.duration, 0);

    document.querySelector('#hello').textContent = `${new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening'}, ${u.name.split(' ')[0]}.`;
    document.querySelector('#weekTotal').textContent = hm(sum(week));
    document.querySelector('#todayTotal').textContent = hm(sum(todayEntries));
    document.querySelector('#projectCount').textContent = projects.length;
    document.querySelector('#entryCount').textContent = tracked.length;

    const byProject = projects.map(p => ({
      ...p,
      total: sum(tracked.filter(e => e.projectId === p.id))
    })).sort((a, b) => b.total - a.total);
    const none = sum(tracked.filter(e => !e.projectId));
    const max = Math.max(1, ...byProject.map(p => p.total), none);
    const rows = byProject.map(p => `<div class="row">
      <i class="dot" style="background:${esc(p.color)}"></i>
      <main><b>${esc(p.name)}</b><small>${esc(p.client || 'No client')}</small>
        <div class="bar"><span style="width:${Math.round(p.total / max * 100)}%;background:${esc(p.color)}"></span></div>
      </main>
      <time>${hm(p.total)}</time>
    </div>`).join('');
    document.querySelector('#projects').innerHTML = rows || '<p class="empty-copy">Create a project to see a breakdown.</p>';

    document.querySelector('#recent').innerHTML = entries.slice(0, 8).map(e => {
      const p = projectById(projects, e.projectId);
      return `<div class="row">
        <i class="dot" style="background:${p ? esc(p.color) : '#6d5dfc'}"></i>
        <main><b>${esc(e.description)}</b><small>${new Date(e.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</small></main>
        <time>${e.running ? 'live' : fmt(e.duration)}</time>
      </div>`;
    }).join('') || '<p class="empty-copy">No time logged yet.</p>';
  }

  document.addEventListener('trackz:refresh', load);
  await load();
})();

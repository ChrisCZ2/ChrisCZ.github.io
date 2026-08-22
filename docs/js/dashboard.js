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
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    weekEnd.setMilliseconds(-1);
    const todayBounds = dayBounds(now);
    const week = entries.filter(e => overlapSeconds(e, weekStart, weekEnd) > 0);
    const todayEntries = entries.filter(e => overlapSeconds(e, todayBounds.start, todayBounds.end) > 0);
    const sum = (list, from, to) => list.reduce((a, e) => a + (from ? overlapSeconds(e, from, to) : durationOf(e)), 0);

    document.querySelector('#hello').textContent = `${new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening'}, ${u.name.split(' ')[0]}.`;
    document.querySelector('#weekTotal').textContent = hm(sum(week, weekStart, weekEnd));
    document.querySelector('#todayTotal').textContent = hm(sum(todayEntries, todayBounds.start, todayBounds.end));
    document.querySelector('#projectCount').textContent = mainProjects(projects).length;
    document.querySelector('#entryCount').textContent = entries.length;

    const mains = mainProjects(projects);
    const byProject = mains.map(p => ({
      ...p,
      total: sum(entries.filter(e => projectTreeIds(projects, p.id).has(e.projectId)))
    })).sort((a, b) => b.total - a.total);
    const none = sum(entries.filter(e => !e.projectId));
    const max = Math.max(1, ...byProject.map(p => p.total), none);
    const rows = byProject.map(p => `<div class="row">
      <i class="dot" style="background:${esc(p.color)}"></i>
      <main><b>${esc(p.name)}</b><small>${esc(p.client || 'No client')}</small>
        <div class="bar"><span style="width:${Math.round(p.total / max * 100)}%;background:${esc(p.color)}"></span></div>
      </main>
      <time>${hm(p.total)}</time>
    </div>`).join('') + (none ? `<div class="row">
      <i class="dot" style="background:#b3aab8"></i>
      <main><b>No project</b><small>Unassigned</small>
        <div class="bar"><span style="width:${Math.round(none / max * 100)}%;background:#b3aab8"></span></div>
      </main>
      <time>${hm(none)}</time>
    </div>` : '');
    document.querySelector('#projects').innerHTML = rows || '<p class="empty-copy">Create a project to see a breakdown.</p>';

    document.querySelector('#recent').innerHTML = entries.slice(0, 8).map(e => {
      const p = projectById(projects, e.projectId);
      return `<div class="row">
        <i class="dot" style="background:${p ? esc(p.color) : '#6d5dfc'}"></i>
        <main><b>${esc(e.description)}</b><small>${new Date(e.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</small></main>
        <time>${e.running ? 'live' : fmt(durationOf(e))}</time>
      </div>`;
    }).join('') || '<p class="empty-copy">No time logged yet.</p>';
  }

  document.addEventListener('trackz:refresh', load);
  await load();
})();

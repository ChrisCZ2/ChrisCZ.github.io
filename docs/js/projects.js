(async () => {
  await requireUser();
  const bar = await mountTrackbar();
  const grid = document.querySelector('#projectGrid');
  const colors = document.querySelector('#quickColors');
  colors.innerHTML = PROJECT_COLORS.map((c, i) => `<button type="button" class="swatch-btn${i ? '' : ' on'}" data-color="${c}" style="background:${c}"></button>`).join('');
  colors.onclick = e => {
    const btn = e.target.closest('.swatch-btn');
    if (!btn) return;
    colors.querySelectorAll('.swatch-btn').forEach(b => b.classList.toggle('on', b === btn));
  };

  async function load() {
    const [projects, entries] = await Promise.all([api('/api/projects'), api('/api/entries')]);
    if (!projects.length) {
      grid.innerHTML = '<div class="panel empty"><p>Create a project, then start the timer from the bar or a project card.</p></div>';
      return;
    }
    grid.innerHTML = projects.map(p => {
      const mine = entries.filter(e => e.projectId === p.id);
      const total = mine.reduce((a, e) => a + (e.running ? 0 : e.duration), 0);
      return `<article class="project-card">
        <div class="project-top">
          <span class="swatch" style="background:${esc(p.color)}"></span>
          <small>${esc(p.client || 'No client')}</small>
        </div>
        <h3>${esc(p.name)}</h3>
        <p>${esc(p.description || 'No description yet')}</p>
        <div class="project-meta">
          <strong>${hm(total)}</strong>
          <span>${mine.length} entries</span>
        </div>
        <div class="project-actions">
          <button class="btn" data-start="${p.id}">Start timer</button>
          <button class="btn ghost danger" data-delete="${p.id}">Delete</button>
        </div>
      </article>`;
    }).join('');
  }

  document.querySelector('#quickAdd').onsubmit = async e => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    body.color = colors.querySelector('.swatch-btn.on')?.dataset.color || PROJECT_COLORS[0];
    await api('/api/projects', { method: 'POST', body: JSON.stringify(body) });
    e.target.reset();
    colors.querySelectorAll('.swatch-btn').forEach((b, i) => b.classList.toggle('on', !i));
    await bar.refresh();
    await load();
  };

  grid.addEventListener('click', async e => {
    const start = e.target.closest('[data-start]');
    const del = e.target.closest('[data-delete]');
    if (start) {
      const projects = await api('/api/projects');
      const p = projectById(projects, start.dataset.start);
      await startTimer({ description: p ? p.name : 'Tracked time', projectId: start.dataset.start });
      await bar.refresh();
      location.href = page('timer.html');
    }
    if (del) {
      await api(`/api/projects/${del.dataset.delete}`, { method: 'DELETE' });
      await bar.refresh();
      await load();
    }
  });

  document.addEventListener('trackz:refresh', load);
  await load();
})();

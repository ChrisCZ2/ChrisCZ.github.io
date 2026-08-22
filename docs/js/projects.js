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
    const mains = mainProjects(projects);
    if (!mains.length) {
      grid.innerHTML = '<div class="panel empty"><p>Create a main project, then add sub-projects under it — the same way Toggl nests tasks.</p></div>';
      return;
    }
    grid.innerHTML = mains.map(p => {
      const kids = childProjects(projects, p.id);
      const tree = projectTreeIds(projects, p.id);
      const mine = entries.filter(e => tree.has(e.projectId));
      const total = mine.reduce((a, e) => a + (e.running ? 0 : e.duration), 0);
      return `<article class="project-card">
        <div class="project-top">
          <span class="swatch" style="background:${esc(p.color)}"></span>
          <small>${esc(p.client || 'Main project')}</small>
        </div>
        <h3>${esc(p.name)}</h3>
        <p>${esc(p.description || 'Add sub-projects for the pieces of this work.')}</p>
        <div class="project-meta">
          <strong>${hm(total)}</strong>
          <span>${mine.length} entries</span>
        </div>
        <div class="sub-list">
          ${kids.map(c => {
            const ct = entries.filter(e => e.projectId === c.id).reduce((a, e) => a + (e.running ? 0 : e.duration), 0);
            return `<div class="sub-row">
              <i class="dot" style="background:${esc(projectColor(projects, c.id))}"></i>
              <b>${esc(c.name)}</b>
              <time>${hm(ct)}</time>
              <button type="button" class="btn ghost" data-start="${c.id}">Start</button>
              <button type="button" class="icon-btn" data-delete="${c.id}" title="Delete sub-project">✕</button>
            </div>`;
          }).join('') || '<p class="empty-copy">No sub-projects yet.</p>'}
          <form class="sub-add" data-parent="${p.id}"><input name="name" placeholder="Add a sub-project" required><button class="btn ghost" type="submit">Add</button></form>
        </div>
        <div class="project-actions">
          <button class="btn" data-start="${p.id}">Start timer</button>
          <button class="btn ghost danger" data-delete="${p.id}">Delete project</button>
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

  grid.addEventListener('submit', async e => {
    const form = e.target.closest('.sub-add');
    if (!form) return;
    e.preventDefault();
    const name = form.name.value.trim();
    if (!name) return;
    const parent = (await api('/api/projects')).find(p => p.id === form.dataset.parent);
    await api('/api/projects', { method: 'POST', body: JSON.stringify({ name, parentId: form.dataset.parent, color: parent?.color }) });
    await bar.refresh();
    await load();
  });

  grid.addEventListener('click', async e => {
    const start = e.target.closest('[data-start]');
    const del = e.target.closest('[data-delete]');
    if (start) {
      const projects = await api('/api/projects');
      await startTimer({ description: projectLabel(projects, start.dataset.start) || 'Tracked time', projectId: start.dataset.start });
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

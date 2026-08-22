(async () => {
  await requireUser();
  const bar = await mountTrackbar();
  const daysEl = document.querySelector('#days');
  const modal = document.querySelector('#modal');
  const form = document.querySelector('#manualForm');
  const projectSel = document.querySelector('#manualProject');

  async function load() {
    const [projects, entries] = await Promise.all([api('/api/projects'), api('/api/entries')]);
    projectSel.innerHTML = '<option value="">No project</option>' + projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    const groups = {};
    entries.forEach(e => {
      const key = dayKey(e.startedAt);
      (groups[key] ||= []).push(e);
    });
    const keys = Object.keys(groups).sort().reverse();
    daysEl.innerHTML = keys.length ? keys.map(key => {
      const list = groups[key];
      const total = list.reduce((a, e) => a + (e.running ? Math.floor((Date.now() - new Date(e.startedAt).getTime()) / 1000) : e.duration), 0);
      return `<section class="day-group">
        <div class="day-head"><h2>${dayLabel(key)}</h2><strong>${hm(total)}</strong></div>
        ${list.map(e => {
          const p = projectById(projects, e.projectId);
          const seconds = e.running ? Math.floor((Date.now() - new Date(e.startedAt).getTime()) / 1000) : e.duration;
          return `<div class="entry ${e.running ? 'live' : ''}">
            <main>
              <b>${esc(e.description)}</b>
              ${projectChip(p)}
              <small>${new Date(e.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${e.running ? ' · tracking' : ''}</small>
            </main>
            <time>${fmt(seconds)}</time>
            <button class="icon-btn" data-continue="${e.id}" title="Continue">▶</button>
            <button class="icon-btn danger" data-delete="${e.id}" title="Delete">✕</button>
          </div>`;
        }).join('')}
      </section>`;
    }).join('') : '<div class="panel empty"><p>No time yet. Type what you’re doing above and hit play.</p></div>';
  }

  daysEl.addEventListener('click', async e => {
    const play = e.target.closest('[data-continue]');
    const del = e.target.closest('[data-delete]');
    if (play) {
      const entries = await api('/api/entries');
      const entry = entries.find(x => x.id === play.dataset.continue);
      if (!entry || entry.running) return;
      await startTimer({ description: entry.description, projectId: entry.projectId });
      await bar.refresh();
    }
    if (del) {
      await api(`/api/entries/${del.dataset.delete}`, { method: 'DELETE' });
      await bar.refresh();
    }
  });

  document.querySelector('#manual').onclick = () => {
    const local = new Date();
    local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
    form.startedAt.value = local.toISOString().slice(0, 16);
    modal.classList.remove('hidden');
  };
  document.querySelector('#close').onclick = () => modal.classList.add('hidden');
  form.onsubmit = async e => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    await api('/api/entries', {
      method: 'POST',
      body: JSON.stringify({
        description: body.description,
        projectId: body.projectId,
        startedAt: new Date(body.startedAt).toISOString(),
        duration: Number(body.duration)
      })
    });
    modal.classList.add('hidden');
    form.reset();
    await load();
  };

  document.addEventListener('trackz:refresh', load);
  await load();
})();

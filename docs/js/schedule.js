(async () => {
  await requireUser();
  await mountTrackbar();
  const cal = document.querySelector('#cal');
  const modal = document.querySelector('#modal');
  const form = document.querySelector('#slotForm');
  const projectSel = document.querySelector('#slotProject');
  let weekOffset = 0;
  const startHour = 7;
  const hours = 13;

  function monday(offset) {
    const now = new Date();
    const day = (now.getDay() + 6) % 7;
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + offset * 7);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  function daysOfWeek() {
    const start = monday(weekOffset);
    return Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }

  async function load() {
    const days = daysOfWeek();
    const [projects, entries, planned] = await Promise.all([api('/api/projects'), api('/api/entries'), api('/api/schedule')]);
    projectSel.innerHTML = '<option value="">No project</option>' + projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    document.querySelector('#weekTitle').textContent = `${days[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${days[6].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;

    const blocks = [
      ...entries.filter(e => !e.running).map(e => ({
        id: e.id,
        kind: 'tracked',
        description: e.description,
        projectId: e.projectId,
        start: new Date(e.startedAt),
        duration: e.duration
      })),
      ...planned.map(s => ({
        id: s.id,
        kind: 'planned',
        description: s.description,
        projectId: s.projectId,
        start: new Date(s.startAt),
        duration: s.duration
      }))
    ];

    cal.innerHTML = `<div class="cal-hours">${Array.from({ length: hours }, (_, i) => `<div>${String(startHour + i).padStart(2, '0')}:00</div>`).join('')}</div>` +
      days.map(day => {
        const key = dayKey(day);
        const isToday = key === dayKey(new Date());
        const dayBlocks = blocks.filter(b => dayKey(b.start) === key);
        return `<div class="cal-day${isToday ? ' today' : ''}">
          <header><small>${day.toLocaleDateString(undefined, { weekday: 'short' })}</small><b>${day.getDate()}</b></header>
          <div class="cal-slots" data-day="${key}">
            ${Array.from({ length: hours }, (_, i) => `<button type="button" class="cal-slot" data-hour="${startHour + i}"></button>`).join('')}
            ${dayBlocks.map(b => {
              const p = projectById(projects, b.projectId);
              const top = ((b.start.getHours() + b.start.getMinutes() / 60) - startHour) * 44;
              const height = Math.max(28, (b.duration / 3600) * 44);
              if (top < -20 || top > hours * 44) return '';
              return `<div class="cal-block ${b.kind}" data-kind="${b.kind}" data-id="${b.id}" style="top:${Math.max(0, top)}px;height:${height}px;background:${p ? p.color : '#6d5dfc'}">
                <b>${esc(b.description)}</b>
                <small>${p ? esc(p.name) : 'No project'} · ${hm(b.duration)}</small>
                <button type="button" data-remove="${b.kind}:${b.id}">✕</button>
              </div>`;
            }).join('')}
          </div>
        </div>`;
      }).join('');
  }

  cal.addEventListener('click', async e => {
    const remove = e.target.closest('[data-remove]');
    const slot = e.target.closest('.cal-slot');
    if (remove) {
      const [kind, id] = remove.dataset.remove.split(':');
      await api(kind === 'planned' ? `/api/schedule/${id}` : `/api/entries/${id}`, { method: 'DELETE' });
      await load();
      return;
    }
    if (!slot) return;
    const day = slot.parentElement.dataset.day;
    const hour = Number(slot.dataset.hour);
    const start = new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`);
    form.startAt.value = start.toISOString();
    document.querySelector('#slotTitle').textContent = start.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    modal.classList.remove('hidden');
  });

  document.querySelector('#close').onclick = () => modal.classList.add('hidden');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const kind = e.submitter?.value || 'plan';
    const body = Object.fromEntries(new FormData(form));
    const payload = {
      description: body.description,
      projectId: body.projectId,
      startAt: body.startAt,
      startedAt: body.startAt,
      duration: Number(body.duration)
    };
    if (kind === 'log') await api('/api/entries', { method: 'POST', body: JSON.stringify(payload) });
    else await api('/api/schedule', { method: 'POST', body: JSON.stringify(payload) });
    modal.classList.add('hidden');
    form.reset();
    await load();
  });

  document.querySelector('#prevWeek').onclick = () => { weekOffset -= 1; load(); };
  document.querySelector('#nextWeek').onclick = () => { weekOffset += 1; load(); };
  document.querySelector('#todayWeek').onclick = () => { weekOffset = 0; load(); };
  document.addEventListener('trackz:refresh', load);
  await load();
})();

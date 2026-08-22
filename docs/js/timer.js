(async () => {
  const user = await requireUser();
  const chip = document.querySelector('#userChip');
  if (chip) chip.textContent = user.name;
  const bar = await mountTrackbar();
  const root = document.querySelector('#viewRoot');
  const params = new URLSearchParams(location.search);
  let view = params.get('view') || 'list';
  let weekOffset = 0;
  const startHour = 7;
  const hours = 13;
  const favKey = 'trackz.favorites';
  const goalKey = 'trackz.weekGoal';

  function monday(offset) {
    const now = new Date();
    const day = (now.getDay() + 6) % 7;
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + offset * 7);
    start.setHours(0, 0, 0, 0);
    return start;
  }
  function weekDays() {
    const start = monday(weekOffset);
    return Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }
  function favorites() {
    try { return JSON.parse(localStorage.getItem(favKey) || '[]'); } catch { return []; }
  }
  function saveFavs(list) { localStorage.setItem(favKey, JSON.stringify(list)); }
  function groupKey(e) { return `${e.description}||${e.projectId || ''}`; }
  function groupDay(list) {
    const map = new Map();
    const order = [];
    list.forEach(e => {
      if (e.running) {
        order.push({ items: [e], running: true });
        return;
      }
      const k = groupKey(e);
      if (!map.has(k)) {
        const g = { items: [], running: false };
        map.set(k, g);
        order.push(g);
      }
      map.get(k).items.push(e);
    });
    return order;
  }

  function entryRow(e, projects, extra = '') {
    const p = projectById(projects, e.projectId);
    const seconds = e.running ? Math.floor((Date.now() - new Date(e.startedAt).getTime()) / 1000) : e.duration;
    const tags = (e.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('');
    return `<div class="te ${e.running ? 'live' : ''}" data-id="${e.id}">
      <input class="te-desc" value="${esc(e.description)}" data-edit="description">
      ${projectChip(p)}
      <div class="te-tags">${tags}</div>
      <button type="button" class="ghost-ico ${e.billable ? 'on' : ''}" data-billable="${e.id}">$</button>
      <span class="te-range">${timeRange(e.startedAt, e.duration, e.running)}</span>
      <time>${fmt(seconds)}</time>
      ${extra}
      <button type="button" class="icon-btn" data-continue="${e.id}" title="Continue">▶</button>
      <button type="button" class="icon-btn" data-fav="${e.id}" title="Favorite">★</button>
      <button type="button" class="icon-btn danger" data-delete="${e.id}" title="Delete">✕</button>
    </div>`;
  }

  async function load() {
    const [projects, entries, planned] = await Promise.all([
      api('/api/projects'),
      api('/api/entries'),
      api('/api/schedule')
    ]);
    const days = weekDays();
    document.querySelector('#rangeLabel').textContent = weekOffset === 0
      ? 'This week'
      : `${days[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${days[6].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
    document.querySelectorAll('.view-tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
    document.querySelectorAll('.side a').forEach(a => {
      if (a.getAttribute('href') === 'timer.html?view=calendar') a.classList.toggle('active', view === 'calendar');
      if (a.getAttribute('href') === 'timer.html') a.classList.toggle('active', view === 'list' || view === 'timesheet');
    });

    const weekStart = days[0];
    const weekEnd = new Date(days[6]);
    weekEnd.setHours(23, 59, 59, 999);
    const inWeek = e => {
      const t = new Date(e.startedAt || e.startAt);
      return t >= weekStart && t <= weekEnd;
    };
    const weekEntries = entries.filter(e => inWeek(e) && !e.running);
    const todayKey = dayKey(new Date());
    const todayEntries = entries.filter(e => dayKey(e.startedAt) === todayKey && !e.running);
    const sum = list => list.reduce((a, e) => a + (e.duration || 0), 0);
    const bill = list => sum(list.filter(e => e.billable));
    document.querySelector('#insToday').textContent = fmt(sum(todayEntries));
    document.querySelector('#insTodayBill').textContent = `${fmt(bill(todayEntries))} billable`;
    document.querySelector('#insWeek').textContent = fmt(sum(weekEntries));
    document.querySelector('#insWeekBill').textContent = `${fmt(bill(weekEntries))} billable`;
    const goal = Number(localStorage.getItem(goalKey) || 40);
    document.querySelector('#weekGoal').value = goal;
    const weekH = sum(weekEntries) / 3600;
    document.querySelector('#goalBar').style.width = `${Math.min(100, Math.round(weekH / goal * 100))}%`;
    document.querySelector('#goalCopy').textContent = `${weekH.toFixed(1)} of ${goal}h`;
    document.querySelector('#favorites').innerHTML = favorites().map((f, i) => {
      const p = projectById(projects, f.projectId);
      return `<button type="button" class="fav" data-fav-start="${i}">${projectChip(p)}<span>${esc(f.description || 'Favorite')}</span></button>`;
    }).join('') || '<p class="empty-copy">Star an entry to pin it here.</p>';

    if (view === 'calendar') {
      const blocks = [
        ...entries.filter(e => !e.running).map(e => ({ ...e, start: new Date(e.startedAt), kind: 'tracked' })),
        ...planned.map(s => ({ ...s, start: new Date(s.startAt), kind: 'planned' }))
      ];
      root.innerHTML = `<div class="cal">${`<div class="cal-hours">${Array.from({ length: hours }, (_, i) => `<div>${String(startHour + i).padStart(2, '0')}:00</div>`).join('')}</div>` + days.map(day => {
        const key = dayKey(day);
        const dayBlocks = blocks.filter(b => dayKey(b.start) === key);
        return `<div class="cal-day${key === todayKey ? ' today' : ''}">
          <header><small>${day.toLocaleDateString(undefined, { weekday: 'short' })}</small><b>${day.getDate()}</b></header>
          <div class="cal-slots" data-day="${key}">
            ${Array.from({ length: hours }, (_, i) => `<button type="button" class="cal-slot" data-hour="${startHour + i}"></button>`).join('')}
            ${dayBlocks.map(b => {
              const p = projectById(projects, b.projectId);
              const top = ((b.start.getHours() + b.start.getMinutes() / 60) - startHour) * 44;
              const height = Math.max(28, ((b.duration || 3600) / 3600) * 44);
              if (top < -20 || top > hours * 44) return '';
              return `<div class="cal-block ${b.kind}" style="top:${Math.max(0, top)}px;height:${height}px;background:${p ? p.color : '#6d5dfc'}"><b>${esc(b.description)}</b><small>${hm(b.duration || 0)}</small></div>`;
            }).join('')}
          </div>
        </div>`;
      }).join('')}</div>`;
      return;
    }

    if (view === 'timesheet') {
      const rows = [{ id: '', name: 'No project', color: '#bbb' }, ...projects];
      root.innerHTML = `<div class="sheet"><table>
        <thead><tr><th>Project</th>${days.map(d => `<th>${d.toLocaleDateString(undefined, { weekday: 'short' })}<br>${d.getDate()}</th>`).join('')}<th>Total</th></tr></thead>
        <tbody>${rows.map(p => {
          const cells = days.map(d => sum(weekEntries.filter(e => dayKey(e.startedAt) === dayKey(d) && (e.projectId || '') === (p.id || ''))));
          const total = cells.reduce((a, n) => a + n, 0);
          if (!total && p.id) return '';
          return `<tr>
            <th><i class="dot" style="background:${esc(p.color)}"></i> ${esc(p.name)}</th>
            ${cells.map(n => `<td>${n ? hm(n) : ''}</td>`).join('')}
            <td>${total ? hm(total) : ''}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`;
      return;
    }

    const visible = entries.filter(e => inWeek(e) || e.running);
    const groups = {};
    visible.forEach(e => {
      const key = dayKey(e.startedAt);
      (groups[key] ||= []).push(e);
    });
    const keys = Object.keys(groups).sort().reverse();
    root.innerHTML = keys.length ? keys.map(key => {
      const list = groups[key];
      const total = list.reduce((a, e) => a + (e.running ? Math.floor((Date.now() - new Date(e.startedAt).getTime()) / 1000) : e.duration), 0);
      return `<section class="day-group toggl-day">
        <div class="day-head">
          <div><b>${dayLabel(key)}</b><small>${dayDate(key)}</small></div>
          <strong>${fmt(total)}</strong>
        </div>
        ${groupDay(list).map(g => {
          if (g.items.length === 1) return entryRow(g.items[0], projects);
          const seconds = g.items.reduce((a, e) => a + e.duration, 0);
          const first = g.items[0];
          const p = projectById(projects, first.projectId);
          return `<div class="te group">
            <span class="count">${g.items.length}</span>
            <b>${esc(first.description)}</b>
            ${projectChip(p)}
            <time>${fmt(seconds)}</time>
            <button type="button" class="icon-btn" data-continue="${first.id}" title="Continue">▶</button>
            <button type="button" class="icon-btn" data-fav="${first.id}" title="Favorite">★</button>
            <div class="group-kids">${g.items.map(e => entryRow(e, projects)).join('')}</div>
          </div>`;
        }).join('')}
      </section>`;
    }).join('') : '<div class="empty-timer"><h2>Let’s track some time</h2><p>Type what you’re working on, use @ for a project and # for a tag, then hit play.</p></div>';
  }

  document.querySelector('.view-tabs').onclick = e => {
    const btn = e.target.closest('[data-view]');
    if (!btn) return;
    view = btn.dataset.view;
    history.replaceState({}, '', view === 'list' ? 'timer.html' : `timer.html?view=${view}`);
    load();
  };
  document.querySelector('#prevRange').onclick = () => { weekOffset -= 1; load(); };
  document.querySelector('#nextRange').onclick = () => { weekOffset += 1; load(); };
  document.querySelector('#todayRange').onclick = () => { weekOffset = 0; load(); };
  document.querySelector('#weekGoal').onchange = e => {
    localStorage.setItem(goalKey, String(e.target.value || 40));
    load();
  };
  document.querySelector('#hideInsights').onclick = () => document.querySelector('#insights').classList.toggle('hidden');

  root.addEventListener('click', async e => {
    const slot = e.target.closest('.cal-slot');
    if (slot) {
      const day = slot.parentElement.dataset.day;
      const hour = Number(slot.dataset.hour);
      const start = new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`);
      await api('/api/schedule', {
        method: 'POST',
        body: JSON.stringify({ description: 'Planned work', startAt: start.toISOString(), duration: 3600 })
      });
      await load();
      return;
    }
    const play = e.target.closest('[data-continue]');
    const del = e.target.closest('[data-delete]');
    const bill = e.target.closest('[data-billable]');
    const fav = e.target.closest('[data-fav]');
    const favStart = e.target.closest('[data-fav-start]');
    if (play) {
      const entries = await api('/api/entries');
      const entry = entries.find(x => x.id === play.dataset.continue);
      if (entry && !entry.running) await startTimer(entry);
      await bar.refresh();
    }
    if (del) {
      await api(`/api/entries/${del.dataset.delete}`, { method: 'DELETE' });
      await bar.refresh();
    }
    if (bill) {
      const entries = await api('/api/entries');
      const entry = entries.find(x => x.id === bill.dataset.billable);
      if (entry) await api(`/api/entries/${entry.id}`, { method: 'PATCH', body: JSON.stringify({ billable: !entry.billable }) });
      await load();
    }
    if (fav) {
      const entries = await api('/api/entries');
      const entry = entries.find(x => x.id === fav.dataset.fav);
      if (!entry) return;
      const list = favorites();
      const i = list.findIndex(f => f.description === entry.description && f.projectId === entry.projectId);
      if (i >= 0) list.splice(i, 1);
      else list.push({ description: entry.description, projectId: entry.projectId, tags: entry.tags || [], billable: !!entry.billable });
      saveFavs(list);
      await load();
    }
    if (favStart) {
      const f = favorites()[Number(favStart.dataset.favStart)];
      if (f) await startTimer(f);
      await bar.refresh();
    }
  });

  root.addEventListener('change', async e => {
    const input = e.target.closest('[data-edit="description"]');
    if (!input) return;
    const row = input.closest('[data-id]');
    if (!row) return;
    await api(`/api/entries/${row.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ description: input.value }) });
  });

  document.querySelector('#insights').addEventListener('click', async e => {
    const favStart = e.target.closest('[data-fav-start]');
    if (!favStart) return;
    const f = favorites()[Number(favStart.dataset.favStart)];
    if (f) await startTimer(f);
    await bar.refresh();
  });

  document.addEventListener('trackz:refresh', load);
  await load();
})();

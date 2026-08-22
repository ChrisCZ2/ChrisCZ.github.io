(async () => {
  const user = await requireUser();
  if (!user) throw new Error('Workspace is not ready');
  const chip = document.querySelector('#userChip');
  if (chip) chip.textContent = user.name || 'My workspace';
  const bar = await mountTrackbar();
  const root = document.querySelector('#viewRoot');
  const editor = document.querySelector('#editor');
  const form = document.querySelector('#editorForm');
  const params = new URLSearchParams(location.search);
  let view = params.get('view') || 'calendar';
  let weekOffset = 0;
  let selected = new Set();
  let create = null;
  let cache = { projects: [], entries: [], planned: [] };
  const favKey = 'trackz.favorites';
  const goalKey = 'trackz.weekGoal';

  function settings() { return getSettings(); }
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
  function weekNum(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil((((t - yearStart) / 86400000) + 1) / 7);
  }
  function favorites() {
    try { return JSON.parse(localStorage.getItem(favKey) || '[]'); } catch { return []; }
  }
  function saveFavs(list) { localStorage.setItem(favKey, JSON.stringify(list)); }
  function toggleFav(entry) {
    const list = favorites();
    const i = list.findIndex(f => f.description === entry.description && f.projectId === (entry.projectId || ''));
    if (i >= 0) list.splice(i, 1);
    else list.push({ description: entry.description, projectId: entry.projectId || '', tags: entry.tags || [], billable: !!entry.billable });
    saveFavs(list);
  }
  function groupKey(e) {
    return [e.description, e.projectId || '', (e.tags || []).join(','), e.billable ? 1 : 0].join('||');
  }
  function groupDay(list) {
    if (!settings().group) return list.map(e => ({ items: [e], running: !!e.running }));
    const map = new Map();
    const order = [];
    list.forEach(e => {
      if (e.running) { order.push({ items: [e], running: true }); return; }
      const k = groupKey(e);
      if (!map.has(k)) { const g = { items: [], running: false }; map.set(k, g); order.push(g); }
      map.get(k).items.push(e);
    });
    return order;
  }
  function findEntry(id) { return cache.entries.find(e => e.id === id); }
  function projectSegments(list, projects) {
    const map = new Map();
    list.forEach(e => {
      const p = projectById(projects, e.projectId);
      const rootP = p?.parentId ? projectById(projects, p.parentId) || p : p;
      const id = rootP?.id || p?.id || 'none';
      const cur = map.get(id) || { id, name: rootP?.name || p?.name || 'No project', color: rootP?.color || p?.color || '#b3aab8', seconds: 0 };
      cur.seconds += durationOf(e);
      map.set(id, cur);
    });
    return [...map.values()].filter(s => s.seconds > 0).sort((a, b) => b.seconds - a.seconds);
  }
  function renderSegBar(el, segs, total) {
    if (!el) return;
    if (!total) { el.innerHTML = '<i class="empty"></i>'; return; }
    el.innerHTML = segs.map(s => `<i style="flex:${s.seconds};background:${esc(s.color)}" title="${esc(s.name)} ${fmt(s.seconds)}"></i>`).join('');
  }
  function weekWindow() {
    const days = weekDays();
    const weekStart = days[0];
    const weekEnd = new Date(days[6]);
    weekEnd.setHours(23, 59, 59, 999);
    return { days, weekStart, weekEnd };
  }
  function entriesInWeek(entries = cache.entries) {
    const { weekStart, weekEnd } = weekWindow();
    return entries.filter(e => {
      const t = new Date(e.startedAt || e.startAt);
      return t >= weekStart && t <= weekEnd;
    });
  }
  function paintWeekStamp() {
    const weekEntries = entriesInWeek();
    const weekSecs = weekEntries.reduce((a, e) => a + durationOf(e), 0);
    const weekTotal = document.querySelector('#weekTotal');
    if (weekTotal) weekTotal.textContent = fmt(weekSecs);
    const segs = projectSegments(weekEntries, cache.projects);
    renderSegBar(document.querySelector('#weekSeg'), segs, weekSecs);
    const legend = document.querySelector('#weekSegLegend');
    if (legend) {
      legend.hidden = segs.length < 2;
      legend.innerHTML = segs.length > 1
        ? segs.map(s => `<span><i class="dot" style="background:${esc(s.color)}"></i>${esc(s.name)} <b>${fmt(s.seconds)}</b></span>`).join('')
        : '';
    }
    const insWeek = document.querySelector('#insWeek');
    if (insWeek) insWeek.textContent = fmt(weekSecs);
    document.querySelectorAll('.graph-dayhead').forEach((head, i) => {
      const day = weekDays()[i];
      if (!day) return;
      const key = dayKey(day);
      const dayList = weekEntries.filter(e => dayKey(e.startedAt) === key);
      const total = dayList.reduce((a, e) => a + durationOf(e), 0);
      const stamp = head.querySelector('span');
      if (stamp) stamp.textContent = fmt(total);
      const mini = head.querySelector('.seg-bar.mini');
      if (mini) renderSegBar(mini, projectSegments(dayList, cache.projects), total);
    });
  }
  function paintLiveStamps() {
    if (!cache.entries.some(e => e.running)) return;
    paintWeekStamp();
    cache.entries.filter(e => e.running).forEach(e => {
      const seconds = durationOf(e);
      document.querySelectorAll(`.cal-block[data-id="${e.id}"] .stamp`).forEach(el => {
        el.textContent = timeRange(e.startedAt, seconds, true);
      });
      document.querySelectorAll(`.te[data-id="${e.id}"] .te-range`).forEach(el => {
        el.textContent = fullStamp(e.startedAt, seconds, true);
      });
      document.querySelectorAll(`.te[data-id="${e.id}"] .te-dur`).forEach(el => {
        el.value = fmt(seconds);
      });
    });
  }
  function packDay(dayBlocks) {
    const items = dayBlocks.map(b => {
      const startMs = b.start.getTime();
      const endMs = startMs + Math.max(durationOf(b), 60) * 1000;
      return { b, startMs, endMs, col: 0, cols: 1 };
    }).sort((a, c) => a.startMs - c.startMs || (c.endMs - c.startMs) - (a.endMs - a.startMs));
    const colEnds = [];
    items.forEach(item => {
      let col = 0;
      while (col < colEnds.length && colEnds[col] > item.startMs + 1000) col += 1;
      item.col = col;
      colEnds[col] = item.endMs;
    });
    items.forEach(item => {
      const peers = items.filter(o => o.startMs < item.endMs && o.endMs > item.startMs);
      item.cols = peers.reduce((max, o) => Math.max(max, o.col + 1), 1);
    });
    return items;
  }
  async function removeEntry(entry) {
    if (!entry?.id) return;
    const copy = { ...entry };
    await api(`/api/entries/${entry.id}`, { method: 'DELETE' });
    showToast(copy.running ? 'Timer deleted' : 'Time entry deleted', 'Undo', async () => {
      if (copy.running) await startTimer(copy);
      else await api('/api/entries', { method: 'POST', body: JSON.stringify(copy) });
      await bar.refresh();
    });
    await bar.refresh();
  }

  let editorRunning = false;
  let editorHoldTick = false;
  function stopEditorTick() {
    clearInterval(openEditor.tick);
    openEditor.tick = null;
  }
  function editorStart() {
    return parseDayTime(form.startTime.value, form.entryDate.value) || new Date();
  }
  function editorEnd() {
    const typed = String(form.endTime.value || '').trim();
    if (editorRunning && (!typed || /^now$/i.test(typed))) return new Date();
    const end = parseDayTime(form.endTime.value, form.entryDate.value);
    if (!end) return new Date(editorStart().getTime() + 3600 * 1000);
    if (end <= editorStart()) end.setDate(end.getDate() + 1);
    return end;
  }
  function paintTimes(start, end, dur, running) {
    form.entryDate.value = dayKey(start);
    form.startTime.value = formatDayTime(start);
    form.endTime.value = running ? '' : formatDayTime(end);
    form.endTime.placeholder = running ? 'now' : '4:10 PM';
    form.duration.value = fmt(Math.max(0, dur));
  }
  function syncEditorTime(changed) {
    const running = editorRunning && !String(form.endTime.value || '').trim();
    let start = editorStart();
    let end = running ? new Date() : editorEnd();
    let dur = Math.max(0, Math.floor((end - start) / 1000));
    if (changed === 'duration') {
      dur = parseClock(form.duration.value);
      if (running) {
        start = new Date(Date.now() - dur * 1000);
        end = new Date();
      } else {
        end = new Date(start.getTime() + dur * 1000);
      }
    } else if (changed === 'start') {
      start = editorStart();
      if (running) {
        if (start > Date.now()) start = new Date();
        end = new Date();
        dur = Math.max(0, Math.floor((end - start) / 1000));
      } else {
        end = new Date(start.getTime() + Math.max(parseClock(form.duration.value), 60) * 1000);
        dur = Math.max(0, Math.floor((end - start) / 1000));
      }
    } else if (changed === 'end') {
      editorRunning = false;
      stopEditorTick();
      end = editorEnd();
      start = editorStart();
      if (end <= start) end = new Date(start.getTime() + 60 * 1000);
      dur = Math.max(0, Math.floor((end - start) / 1000));
    } else if (changed === 'date') {
      const next = parseDayTime(form.startTime.value, form.entryDate.value) || start;
      const keep = Math.max(parseClock(form.duration.value), running ? durationOf({ running: true, startedAt: start.toISOString() }) : dur);
      start = next;
      end = running ? new Date() : new Date(start.getTime() + keep * 1000);
      dur = running ? Math.max(0, Math.floor((end - start) / 1000)) : keep;
    }
    paintTimes(start, end, dur, running);
  }

  function placeEditor(x, y) {
    const card = document.querySelector('#editorCard');
    if (!card) return;
    const w = Math.min(440, window.innerWidth - 24);
    const left = Math.max(12, Math.min((x ?? 80) + 16, window.innerWidth - w - 12));
    const top = Math.max(12, Math.min((y ?? 80) - 12, window.innerHeight - 80));
    card.style.left = left + 'px';
    card.style.top = top + 'px';
  }

  function openEditor(entry, ev) {
    stopEditorTick();
    editorRunning = !!entry.running;
    form.entryId.value = entry.id || '';
    form.description.value = entry.description || '';
    const selectedProject = entry.projectId || bar.getProjectId() || lastProjectId(cache.projects);
    form.projectId.innerHTML = projectOptions(cache.projects, selectedProject);
    form.tags.value = (entry.tags || []).join(', ');
    form.billable.checked = !!entry.billable;
    const start = new Date(entry.startedAt || Date.now());
    const dur = durationOf(entry) || (entry.id ? 0 : 3600);
    const end = entry.endedAt ? new Date(entry.endedAt) : new Date(start.getTime() + dur * 1000);
    paintTimes(start, end, dur, editorRunning);
    const title = document.querySelector('#editorTitle');
    if (title) title.textContent = editorRunning ? 'Running timer' : (entry.id ? 'Edit time entry' : 'New time entry');
    form.querySelectorAll('input,select,textarea,button').forEach(el => { el.disabled = false; el.readOnly = false; });
    form.querySelector('[data-act="stop"]').hidden = !editorRunning;
    form.querySelector('[data-act="continue"]').hidden = editorRunning;
    placeEditor(ev?.clientX, ev?.clientY);
    editor.hidden = false;
    if (editorRunning) {
      openEditor.tick = setInterval(() => {
        if (editor.hidden || editorHoldTick || String(form.endTime.value || '').trim()) return;
        const liveStart = editorStart();
        paintTimes(liveStart, new Date(), Math.max(0, Math.floor((Date.now() - liveStart.getTime()) / 1000)), true);
      }, 500);
    }
  }

  function draftFromForm() {
    const running = editorRunning && !String(form.endTime.value || '').trim();
    const start = editorStart();
    const end = running ? new Date() : editorEnd();
    return {
      description: form.description.value.trim() || 'Tracked time',
      projectId: form.projectId.value,
      tags: form.tags.value.split(',').map(s => s.trim()).filter(Boolean),
      billable: form.billable.checked,
      startedAt: start.toISOString(),
      endedAt: end.toISOString(),
      duration: Math.max(0, Math.floor((end - start) / 1000)),
      running
    };
  }

  async function persistEditor() {
    const id = form.entryId.value;
    const draft = draftFromForm();
    if (id && draft.running) {
      await saveEntry(id, {
        description: draft.description,
        projectId: draft.projectId,
        tags: draft.tags,
        billable: draft.billable,
        startedAt: draft.startedAt,
        running: true
      });
    } else if (id) {
      await saveEntry(id, { ...draft, running: false });
    } else {
      await api('/api/entries', { method: 'POST', body: JSON.stringify({ ...draft, running: false }) });
    }
    if (draft.projectId) rememberProject(draft.projectId);
    stopEditorTick();
    editor.hidden = true;
    await bar.refresh();
  }

  form.onsubmit = async e => { e.preventDefault(); await persistEditor(); };
  form.duration.addEventListener('focus', () => { editorHoldTick = true; });
  form.duration.addEventListener('blur', () => { editorHoldTick = false; syncEditorTime('duration'); });
  form.duration.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); form.duration.blur(); } });
  form.startTime.addEventListener('change', () => syncEditorTime('start'));
  form.startTime.addEventListener('blur', () => syncEditorTime('start'));
  form.endTime.addEventListener('change', () => { if (String(form.endTime.value || '').trim()) syncEditorTime('end'); });
  form.endTime.addEventListener('blur', () => { if (String(form.endTime.value || '').trim()) syncEditorTime('end'); });
  form.entryDate.addEventListener('change', () => syncEditorTime('date'));
  document.querySelector('#editorClose').onclick = () => { stopEditorTick(); editor.hidden = true; };
  editor.addEventListener('mousedown', e => {
    if (e.target === editor) { stopEditorTick(); editor.hidden = true; }
  });
  (function bindEditorDrag() {
    const card = document.querySelector('#editorCard');
    const handle = document.querySelector('#editorTitle');
    if (!card || !handle) return;
    let dragWin = null;
    handle.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const r = card.getBoundingClientRect();
      dragWin = { x: e.clientX - r.left, y: e.clientY - r.top };
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', e => {
      if (!dragWin) return;
      card.style.left = Math.max(8, e.clientX - dragWin.x) + 'px';
      card.style.top = Math.max(8, e.clientY - dragWin.y) + 'px';
    });
    handle.addEventListener('pointerup', () => { dragWin = null; });
  })();
  form.querySelectorAll('[data-act]').forEach(btn => {
    btn.onclick = async ev => {
      ev.preventDefault();
      ev.stopPropagation();
      const act = btn.dataset.act;
      const id = form.entryId.value;
      const entry = findEntry(id) || draftFromForm();
      if (act === 'stop') {
        if (id && findEntry(id)?.running) await api('/api/timer/stop', { method: 'POST' });
        stopEditorTick();
        editor.hidden = true;
        await bar.refresh();
        return;
      }
      if (act === 'continue') {
        if (entry.running) return;
        stopEditorTick();
        editor.hidden = true;
        await startTimer(entry);
        await bar.refresh();
        return;
      }
      if (act === 'duplicate') {
        const copy = draftFromForm();
        await api('/api/entries', { method: 'POST', body: JSON.stringify({ ...copy, running: false }) });
        stopEditorTick();
        editor.hidden = true;
        await bar.refresh();
        return;
      }
      if (act === 'split') {
        if (!id || findEntry(id)?.running) { showToast('Stop the timer before splitting'); return; }
        try { await splitEntry(findEntry(id)); stopEditorTick(); editor.hidden = true; await bar.refresh(); }
        catch (err) { showToast(err.message); }
        return;
      }
      if (act === 'favorite') { toggleFav(draftFromForm()); await load(); return; }
      if (act === 'project') { location.href = page('projects.html'); return; }
      if (act === 'delete') {
        stopEditorTick();
        editor.hidden = true;
        await removeEntry(entry);
      }
    };
  });

  function entryRow(e) {
    const p = projectById(cache.projects, e.projectId);
    const seconds = durationOf(e);
    const tags = (e.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('');
    return `<div class="te ${e.running ? 'live' : ''}" data-id="${e.id}">
      <input type="checkbox" class="pick" data-pick="${e.id}" ${selected.has(e.id) ? 'checked' : ''}>
      <input class="te-desc" value="${esc(e.description)}" data-edit="description">
      <button type="button" class="chip-btn" data-edit-project="${e.id}">${projectChip(p, cache.projects)}</button>
      <button type="button" class="te-tags" data-edit-tags="${e.id}">${tags || '<span class="muted">#</span>'}</button>
      <button type="button" class="ghost-ico ${e.billable ? 'on' : ''}" data-billable="${e.id}">$</button>
      <button type="button" class="te-range" data-open="${e.id}">${fullStamp(e.startedAt, seconds, e.running)}</button>
      <input class="te-dur" value="${fmt(seconds)}" data-edit-dur="${e.id}">
      <button type="button" class="icon-btn" data-continue="${e.id}" title="Continue">▶</button>
      <div class="more">
        <button type="button" class="icon-btn" data-more="${e.id}">⋯</button>
        <div class="more-menu hidden">
          <button type="button" data-open="${e.id}">Edit</button>
          <button type="button" data-duplicate="${e.id}">Duplicate</button>
          <button type="button" data-split="${e.id}">Split</button>
          <button type="button" data-fav="${e.id}">Pin as favorite</button>
          <button type="button" data-goto="${e.projectId || ''}">Go to project</button>
          <button type="button" data-delete="${e.id}">Delete</button>
        </div>
      </div>
    </div>`;
  }

  async function load() {
    const [projects, entries, planned] = await Promise.all([api('/api/projects'), api('/api/entries'), api('/api/schedule')]);
    cache = { projects, entries, planned };
    const days = weekDays();
    const cfg = settings();
    document.querySelector('#rangeLabel').textContent = weekOffset === 0 ? 'This week' : `Week ${weekNum(days[0])}`;
    const datesEl = document.querySelector('#rangeDates');
    if (datesEl) datesEl.textContent = weekStamp(days[0], days[6]);
    document.querySelectorAll('.view-tabs [data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === view));
    document.querySelectorAll('.side a[href="timer.html"]').forEach(a => a.classList.toggle('active', true));
    document.querySelector('#bulkBar').hidden = selected.size === 0;
    document.querySelector('#bulkCount').textContent = `${selected.size} selected`;

    const { weekStart, weekEnd } = weekWindow();
    const inWeek = e => {
      const t = new Date(e.startedAt || e.startAt);
      return t >= weekStart && t <= weekEnd;
    };
    const weekEntries = entries.filter(e => inWeek(e));
    const todayKey = dayKey(new Date());
    const todayEntries = entries.filter(e => dayKey(e.startedAt) === todayKey);
    const sum = list => list.reduce((a, e) => a + durationOf(e), 0);
    const bill = list => sum(list.filter(e => e.billable));
    document.querySelector('#insToday').textContent = fmt(sum(todayEntries));
    document.querySelector('#insTodayBill').textContent = `${fmt(bill(todayEntries))} billable`;
    document.querySelector('#insWeekBill').textContent = `${fmt(bill(weekEntries))} billable`;
    paintWeekStamp();
    const goal = Number(localStorage.getItem(goalKey) || 40);
    document.querySelector('#weekGoal').value = goal;
    const weekH = sum(weekEntries) / 3600;
    document.querySelector('#goalBar').style.width = `${Math.min(100, Math.round(weekH / goal * 100))}%`;
    document.querySelector('#goalCopy').textContent = `${weekH.toFixed(1)} of ${goal}h`;
    document.querySelector('#favorites').innerHTML = favorites().map((f, i) => {
      const p = projectById(projects, f.projectId);
      return `<button type="button" class="fav" data-fav-start="${i}"><small>${i + 1}</small>${projectChip(p, projects)}<span>${esc(f.description || 'Favorite')}</span></button>`;
    }).join('') || '<p class="empty-copy">Pin an entry as a favorite, then press 1–9.</p>';
    const strip = document.querySelector('#projectStrip');
    if (strip) {
      const current = bar.getProjectId() || lastProjectId(projects);
      strip.innerHTML = mainProjects(projects).length
        ? mainProjects(projects).map(p => {
          const kids = childProjects(projects, p.id);
          const tree = projectTreeIds(projects, p.id);
          const total = sum(weekEntries.filter(e => tree.has(e.projectId)));
          return `<div class="proj-family">
            <button type="button" class="proj-chip${current === p.id || kids.some(c => c.id === current) ? ' on' : ''}" data-start-project="${p.id}">
              <i class="dot" style="background:${esc(p.color)}"></i>
              <b>${esc(p.name)}</b>
              <span>${hm(total)}</span>
            </button>
            <div class="proj-kids">
              ${kids.map(c => `<button type="button" class="proj-chip sub${c.id === current ? ' on' : ''}" data-start-project="${c.id}">
                <b>${esc(c.name)}</b>
                <span>${hm(sum(weekEntries.filter(e => e.projectId === c.id)))}</span>
              </button>`).join('')}
              <form class="sub-add" data-parent="${p.id}"><input name="name" placeholder="+ Sub-project" required></form>
            </div>
          </div>`;
        }).join('') + '<a class="proj-chip add" href="projects.html">+ New project</a>'
        : '<a class="proj-chip add" href="projects.html">Create a project to start tracking</a>';
    }

    const startHour = cfg.calStart;
    const hours = Math.max(8, cfg.calEnd - cfg.calStart);

    if (view === 'calendar') {
      const rowH = 48;
      const now = new Date();
      const nowTop = ((now.getHours() + now.getMinutes() / 60) - startHour) * rowH;
      const blocks = entries.map(e => ({ ...e, start: new Date(e.startedAt) }));
      root.innerHTML = `${weekEntries.length ? '' : '<p class="cal-hint">Click a time slot or press play. Use a project chip so this week stays organized.</p>'}<div class="graph" style="--hours:${hours};--row:${rowH}px">
        <div class="graph-corner"></div>
        ${days.map(day => {
          const key = dayKey(day);
          const total = sum(weekEntries.filter(e => dayKey(e.startedAt) === key));
          const daySegs = projectSegments(weekEntries.filter(e => dayKey(e.startedAt) === key), projects);
          return `<div class="graph-dayhead${key === todayKey ? ' today' : ''}">
            <b>${day.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()}</b>
            <em>${monthDayYear(day)}</em>
            <span>${fmt(total)}</span>
            ${daySegs.length ? `<div class="seg-bar mini">${daySegs.map(s => `<i style="flex:${s.seconds};background:${esc(s.color)}" title="${esc(s.name)} ${fmt(s.seconds)}"></i>`).join('')}</div>` : ''}
          </div>`;
        }).join('')}
        <div class="graph-hours">${Array.from({ length: hours }, (_, i) => `<div>${startHour + i}:00</div>`).join('')}</div>
        ${days.map(day => {
          const key = dayKey(day);
          const dayBlocks = packDay(blocks.filter(b => dayKey(b.start) === key));
          return `<div class="graph-col${key === todayKey ? ' today' : ''}">
            <div class="cal-slots" data-day="${key}">
              ${Array.from({ length: hours * 2 }, (_, i) => `<button type="button" class="cal-slot half" data-hour="${startHour + i / 2}"></button>`).join('')}
            </div>
            ${dayBlocks.map(item => {
              const b = item.b;
              const color = projectColor(projects, b.projectId);
              const top = Math.round(((b.start.getHours() + b.start.getMinutes() / 60) - startHour) * rowH);
              const height = Math.max(52, Math.round((Math.max(durationOf(b), 1500) / 3600) * rowH));
              if (top < -20 || top > hours * rowH) return '';
              const gap = 10;
              const left = `calc(${(item.col / item.cols) * 100}% + ${gap / 2}px)`;
              const width = `calc(${100 / item.cols}% - ${gap}px)`;
              return `<article class="cal-block${b.running ? ' live' : ''}" data-id="${b.id}" style="top:${Math.max(0, top)}px;height:${height}px;left:${left};width:${width};--proj:${color};background:${hexTint(color)}">
                <div class="cal-tools">
                  <button type="button" data-open="${b.id}" title="Edit">✎</button>
                  <button type="button" data-delete="${b.id}" title="Delete">✕</button>
                </div>
                <b>${esc(b.description || projectLabel(projects, b.projectId) || 'Time entry')}</b>
                <small>${esc(projectLabel(projects, b.projectId) || 'No project')}</small>
                <small class="stamp" title="${esc(fullStamp(b.startedAt, durationOf(b), b.running))}">${timeRange(b.startedAt, durationOf(b), b.running)}</small>
                <i class="resize resize-top" data-edge="start"></i>
                <i class="resize" data-edge="end"></i>
              </article>`;
            }).join('')}
            ${key === todayKey && nowTop > 0 && nowTop < hours * rowH ? `<div class="now-line" style="top:${nowTop}px"><i></i></div>` : ''}
          </div>`;
        }).join('')}
      </div>`;
      bindCalendar();
      return;
    }

    if (view === 'timesheet') {
      const rows = [{ id: '', name: 'No project', color: '#bbb' }].concat(mainProjects(projects).flatMap(p => [
        p,
        ...childProjects(projects, p.id).map(c => ({ ...c, name: `${p.name} / ${c.name}` }))
      ]));
      root.innerHTML = `<div class="sheet"><table>
        <thead><tr><th>Project</th>${days.map(d => `<th>${d.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()}<br><span class="sheet-date">${monthDayYear(d)}</span></th>`).join('')}<th>Total</th></tr></thead>
        <tbody>${rows.map(p => {
          const cells = days.map(d => weekEntries.filter(e => dayKey(e.startedAt) === dayKey(d) && (e.projectId || '') === (p.id || '')));
          const total = cells.reduce((a, list) => a + sum(list), 0);
          return `<tr data-project="${p.id}">
            <th><i class="dot" style="background:${esc(p.color)}"></i> ${esc(p.name)}</th>
            ${cells.map((list, i) => `<td><input class="sheet-cell" data-day="${dayKey(days[i])}" data-project="${p.id}" value="${sum(list) ? (sum(list) / 3600).toFixed(2) : ''}" placeholder="0"></td>`).join('')}
            <td>${total ? hm(total) : ''}</td>
          </tr>`;
        }).join('')}<tr class="totals"><th>Total</th>${days.map(d => `<td>${hm(sum(weekEntries.filter(e => dayKey(e.startedAt) === dayKey(d))))}</td>`).join('')}<td>${hm(sum(weekEntries))}</td></tr></tbody>
      </table></div>`;
      return;
    }

    const visible = entries.filter(e => inWeek(e) || e.running);
    const groups = {};
    visible.forEach(e => { (groups[dayKey(e.startedAt)] ||= []).push(e); });
    const keys = Object.keys(groups).sort().reverse();
    root.innerHTML = keys.length ? keys.map(key => {
      const list = groups[key];
      const total = list.reduce((a, e) => a + durationOf(e), 0);
      const daySegs = projectSegments(list, projects);
      return `<section class="day-group toggl-day">
        <div class="day-head">
          <div>
            <label class="check"><input type="checkbox" data-select-day="${key}"> <b>${dayLabel(key)}</b></label>
            <small>${monthDayYear(key)}</small>
          </div>
          <strong>${fmt(total)}</strong>
        </div>
        ${daySegs.length ? `<div class="seg-bar mini day-seg">${daySegs.map(s => `<i style="flex:${s.seconds};background:${esc(s.color)}" title="${esc(s.name)} ${fmt(s.seconds)}"></i>`).join('')}</div>` : ''}
        ${groupDay(list).map(g => {
          if (g.items.length === 1) return entryRow(g.items[0]);
          const seconds = g.items.reduce((a, e) => a + durationOf(e), 0);
          const first = g.items[0];
          const p = projectById(projects, first.projectId);
          return `<div class="te group" data-expand>
            <span class="count">${g.items.length}</span>
            <b>${esc(first.description)}</b>
            ${projectChip(p, cache.projects)}
            <time>${fmt(seconds)}</time>
            <button type="button" class="icon-btn" data-continue="${first.id}" title="Continue">▶</button>
            <button type="button" class="icon-btn" data-more="${first.id}">⋯</button>
            <div class="group-kids">${g.items.map(entryRow).join('')}</div>
          </div>`;
        }).join('')}
      </section>`;
    }).join('') : '<div class="empty-timer"><h2>Let’s track some time</h2><p>Type what you’re working on, use @ for a project and # for a tag, then hit play. Press N to start, M for manual, C to continue.</p></div>';
  }

  function bindCalendar() {
    const rowH = 48;
    const startHour = settings().calStart;
    function atHour(day, hour) {
      const snapped = Math.max(0, Math.min(23.75, Math.round(hour * 4) / 4));
      const h = Math.floor(snapped);
      const m = Math.round((snapped - h) * 60);
      return new Date(`${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);
    }
    function pointToDate(x, y) {
      const cols = [...root.querySelectorAll('.graph-col')];
      let col = cols.find(c => {
        const r = c.getBoundingClientRect();
        return x >= r.left && x <= r.right;
      });
      if (!col && cols.length) {
        col = cols.reduce((best, c) => {
          const r = c.getBoundingClientRect();
          const dist = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
          return !best || dist < best.dist ? { c, dist } : best;
        }, null).c;
      }
      const day = col?.querySelector('.cal-slots')?.dataset.day;
      if (!day) return null;
      return atHour(day, startHour + (y - col.getBoundingClientRect().top) / rowH);
    }
    function applyMove(entry, start) {
      if (entry.running) return saveEntry(entry.id, { startedAt: start.toISOString(), running: true });
      return saveEntry(entry.id, { startedAt: start.toISOString(), duration: durationOf(entry) || 1800 });
    }

    root.querySelectorAll('.cal-block').forEach(block => {
      block.addEventListener('pointerdown', e => {
        if (e.button !== 0 || e.target.closest('.cal-tools')) return;
        const entry = findEntry(block.dataset.id);
        if (!entry) return;
        e.preventDefault();
        e.stopPropagation();
        const edge = e.target.closest('[data-edge]')?.dataset.edge || 'move';
        const origin = { x: e.clientX, y: e.clientY, top: parseFloat(block.style.top) || 0, height: parseFloat(block.style.height) || 52 };
        let moved = false;
        const onMove = ev => {
          if (Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) > 5) moved = true;
          if (!moved) return;
          block.classList.add('dragging');
          if (edge === 'move') {
            const next = pointToDate(ev.clientX, ev.clientY);
            if (!next) return;
            block.style.top = Math.max(0, ((next.getHours() + next.getMinutes() / 60) - startHour) * rowH) + 'px';
            const col = [...root.querySelectorAll('.graph-col')].find(c => {
              const r = c.getBoundingClientRect();
              return ev.clientX >= r.left && ev.clientX <= r.right;
            });
            if (col && block.parentElement !== col) col.appendChild(block);
          } else if (edge === 'end') {
            block.style.height = Math.max(36, origin.height + ev.clientY - origin.y) + 'px';
          } else if (edge === 'start') {
            const dy = ev.clientY - origin.y;
            block.style.top = Math.max(0, origin.top + dy) + 'px';
            block.style.height = Math.max(36, origin.height - dy) + 'px';
          }
        };
        const onUp = async ev => {
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          block.classList.remove('dragging');
          if (!moved) { openEditor(entry, ev); return; }
          if (edge === 'move') {
            const next = pointToDate(ev.clientX, ev.clientY);
            if (next) await applyMove(entry, next);
          } else if (edge === 'end') {
            const hours = Math.max(0.25, (origin.height + ev.clientY - origin.y) / rowH);
            const duration = Math.round(hours * 3600);
            if (entry.running) await saveEntry(entry.id, { startedAt: new Date(Date.now() - duration * 1000).toISOString(), running: true });
            else await saveEntry(entry.id, { startedAt: entry.startedAt, duration, endedAt: new Date(new Date(entry.startedAt).getTime() + duration * 1000).toISOString() });
          } else if (edge === 'start') {
            const col = block.closest('.graph-col');
            const next = pointToDate((col || block).getBoundingClientRect().left + 8, col.getBoundingClientRect().top + parseFloat(block.style.top));
            const start = next || new Date(entry.startedAt);
            if (entry.running) await saveEntry(entry.id, { startedAt: start.toISOString(), running: true });
            else {
              const end = new Date(new Date(entry.startedAt).getTime() + (durationOf(entry) || 1800) * 1000);
              await saveEntry(entry.id, { startedAt: start.toISOString(), duration: Math.max(60, Math.round((end - start) / 1000)) });
            }
          }
          await bar.refresh();
        };
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
      });
    });

    root.querySelectorAll('.cal-slots').forEach(col => {
      col.addEventListener('pointerdown', e => {
        if (e.target.closest('.cal-block, .cal-tools, .resize')) return;
        const slot = e.target.closest('.cal-slot');
        if (!slot || e.button !== 0) return;
        create = { day: col.dataset.day, start: Number(slot.dataset.hour), end: Number(slot.dataset.hour) + 0.25 };
      });
    });
  }

  root.addEventListener('pointermove', e => {
    if (!create) return;
    const slot = e.target.closest('.cal-slot');
    if (slot) create.end = Number(slot.dataset.hour) + 0.25;
  });
  root.addEventListener('pointerup', e => {
    if (!create) return;
    if (e.target.closest('.cal-block')) { create = null; return; }
    const a = Math.min(create.start, create.end);
    const b = Math.max(create.start, create.end);
    const start = new Date(`${create.day}T${String(Math.floor(a)).padStart(2, '0')}:${a % 1 ? String(Math.round((a % 1) * 60)).padStart(2, '0') : '00'}:00`);
    const duration = Math.max(900, Math.round((b - a) * 3600));
    const projectId = bar.getProjectId() || lastProjectId(cache.projects);
    create = null;
    openEditor({
      description: projectById(cache.projects, projectId)?.name || '',
      projectId,
      startedAt: start.toISOString(),
      duration,
      endedAt: new Date(start.getTime() + duration * 1000).toISOString()
    }, e);
  });

  document.querySelector('.view-tabs').onclick = e => {
    const btn = e.target.closest('[data-view]');
    if (!btn) return;
    view = btn.dataset.view;
    selected.clear();
    history.replaceState({}, '', view === 'list' ? 'timer.html' : `timer.html?view=${view}`);
    load();
  };
  document.querySelector('#prevRange').onclick = () => { weekOffset -= 1; load(); };
  document.querySelector('#nextRange').onclick = () => { weekOffset += 1; load(); };
  document.querySelector('#todayRange').onclick = () => { weekOffset = 0; load(); };
  document.querySelector('#weekGoal').onchange = e => { localStorage.setItem(goalKey, String(e.target.value || 40)); load(); };
  document.querySelector('#hideInsights').onclick = () => { document.querySelector('#insights').hidden = true; };
  document.querySelector('#showInsights').onclick = () => { document.querySelector('#insights').hidden = false; };

  const setBox = document.querySelector('#settings');
  document.querySelector('#settingsBtn').onclick = () => {
    const s = settings();
    document.querySelector('#setGroup').checked = s.group;
    document.querySelector('#setShortcuts').checked = s.shortcuts;
    document.querySelector('#setCalStart').value = s.calStart;
    document.querySelector('#setCalEnd').value = s.calEnd;
    setBox.hidden = false;
  };
  document.querySelector('#settingsClose').onclick = () => { setBox.hidden = true; };
  ['setGroup', 'setShortcuts'].forEach(id => {
    document.querySelector('#' + id).onchange = () => {
      setSettings({ group: document.querySelector('#setGroup').checked, shortcuts: document.querySelector('#setShortcuts').checked });
      load();
    };
  });
  ['setCalStart', 'setCalEnd'].forEach(id => {
    document.querySelector('#' + id).onchange = () => {
      setSettings({ calStart: Number(document.querySelector('#setCalStart').value), calEnd: Number(document.querySelector('#setCalEnd').value) });
      load();
    };
  });

  document.querySelector('#shortcutsClose').onclick = () => { document.querySelector('#shortcuts').hidden = true; };

  root.addEventListener('click', async e => {
    const more = e.target.closest('[data-more]');
    if (more) {
      const menu = more.parentElement.querySelector('.more-menu');
      document.querySelectorAll('.more-menu').forEach(m => { if (m !== menu) m.classList.add('hidden'); });
      if (menu) menu.classList.toggle('hidden');
      return;
    }
    const expand = e.target.closest('[data-expand]');
    if (expand && !e.target.closest('button,input,.group-kids')) expand.classList.toggle('open');
    const open = e.target.closest('[data-open]');
    if (open) { const entry = findEntry(open.dataset.open); if (entry) openEditor(entry, e); }
    const play = e.target.closest('[data-continue]');
    const del = e.target.closest('[data-delete]');
    const bill = e.target.closest('[data-billable]');
    const fav = e.target.closest('[data-fav]');
    const dup = e.target.closest('[data-duplicate]');
    const split = e.target.closest('[data-split]');
    const go = e.target.closest('[data-goto]');
    const pick = e.target.closest('[data-pick]');
    const daySel = e.target.closest('[data-select-day]');
    if (play) { const entry = findEntry(play.dataset.continue); if (entry && !entry.running) await startTimer(entry); await bar.refresh(); }
    if (del) {
      e.stopPropagation();
      await removeEntry(findEntry(del.dataset.delete));
    }
    if (bill) { const entry = findEntry(bill.dataset.billable); if (entry) await saveEntry(entry.id, { billable: !entry.billable }); await load(); }
    if (fav) { const entry = findEntry(fav.dataset.fav); if (entry) toggleFav(entry); await load(); }
    if (dup) { const entry = findEntry(dup.dataset.duplicate); if (entry) await duplicateEntry(entry); await bar.refresh(); }
    if (split) {
      try { await splitEntry(findEntry(split.dataset.split)); await bar.refresh(); }
      catch (err) { showToast(err.message); }
    }
    if (go && go.dataset.goto) location.href = page('projects.html');
    if (pick) {
      if (pick.checked) selected.add(pick.dataset.pick); else selected.delete(pick.dataset.pick);
      await load();
    }
    if (daySel) {
      cache.entries.filter(x => dayKey(x.startedAt) === daySel.dataset.selectDay).forEach(x => selected.add(x.id));
      await load();
    }
  });

  root.addEventListener('change', async e => {
    const desc = e.target.closest('[data-edit="description"]');
    const dur = e.target.closest('[data-edit-dur]');
    const cell = e.target.closest('.sheet-cell');
    if (desc) {
      const row = desc.closest('[data-id]');
      await saveEntry(row.dataset.id, { description: desc.value });
    }
    if (dur) {
      const entry = findEntry(dur.dataset.editDur);
      if (entry) await saveEntry(entry.id, { startedAt: entry.startedAt, duration: parseClock(dur.value) });
      await bar.refresh();
    }
    if (cell) {
      const hours = Number(cell.value);
      const day = cell.dataset.day;
      const projectId = cell.dataset.project || '';
      const existing = cache.entries.filter(x => !x.running && dayKey(x.startedAt) === day && (x.projectId || '') === projectId);
      const next = Math.round((hours || 0) * 3600);
      if (!next && existing.length) {
        for (const e2 of existing) await api(`/api/entries/${e2.id}`, { method: 'DELETE' });
      } else if (existing[0]) {
        await saveEntry(existing[0].id, { startedAt: existing[0].startedAt, duration: next });
      } else if (next) {
        await api('/api/entries', { method: 'POST', body: JSON.stringify({ description: 'Timesheet', projectId, startedAt: new Date(`${day}T09:00:00`).toISOString(), duration: next }) });
      }
      await bar.refresh();
    }
  });

  document.querySelector('#bulkBillable').onclick = async () => {
    for (const id of selected) await saveEntry(id, { billable: true });
    selected.clear();
    await bar.refresh();
  };
  document.querySelector('#bulkUnbillable').onclick = async () => {
    for (const id of selected) await saveEntry(id, { billable: false });
    selected.clear();
    await bar.refresh();
  };
  document.querySelector('#bulkDelete').onclick = async () => {
    const copies = [...selected].map(findEntry).filter(Boolean);
    for (const id of selected) await api(`/api/entries/${id}`, { method: 'DELETE' });
    selected.clear();
    showToast('Entries deleted', 'Undo', async () => {
      for (const e of copies) await api('/api/entries', { method: 'POST', body: JSON.stringify(e) });
      await bar.refresh();
    });
    await bar.refresh();
  };
  document.querySelector('#bulkClear').onclick = () => { selected.clear(); load(); };

  document.querySelector('#projectStrip')?.addEventListener('click', async e => {
    const btn = e.target.closest('[data-start-project]');
    if (!btn) return;
    const p = projectById(cache.projects, btn.dataset.startProject);
    rememberProject(btn.dataset.startProject);
    await startTimer({ description: p ? projectLabel(cache.projects, p.id) : 'Tracked time', projectId: btn.dataset.startProject });
    await bar.refresh();
  });
  document.querySelector('#projectStrip')?.addEventListener('submit', async e => {
    const form = e.target.closest('.sub-add');
    if (!form) return;
    e.preventDefault();
    const name = form.name.value.trim();
    if (!name) return;
    const parent = projectById(cache.projects, form.dataset.parent);
    const created = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name, parentId: form.dataset.parent, color: parent?.color }) });
    rememberProject(created.id);
    form.reset();
    await bar.refresh();
  });

  document.querySelector('#insights').addEventListener('click', async e => {
    const favStart = e.target.closest('[data-fav-start]');
    if (!favStart) return;
    const f = favorites()[Number(favStart.dataset.favStart)];
    if (f) await startTimer(f);
    await bar.refresh();
  });
  document.addEventListener('trackz:fav', async e => {
    const f = favorites()[e.detail];
    if (f) await startTimer(f);
    await bar.refresh();
  });

  document.addEventListener('keydown', async e => {
    if (!settings().shortcuts) return;
    const typing = /input|textarea|select/i.test(e.target.tagName);
    if (e.shiftKey && e.key === '?') { document.querySelector('#shortcuts').hidden = false; return; }
    if (typing) return;
    if (e.key === 'Escape') {
      stopEditorTick();
      editor.hidden = true;
      document.querySelector('#shortcuts').hidden = true;
      document.querySelector('#settings').hidden = true;
    }
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); await bar.startNew(); }
    if (e.key === 's' || e.key === 'S') { e.preventDefault(); await bar.stop(); }
    if (e.key === 'm' || e.key === 'M') { e.preventDefault(); bar.setMode('manual'); }
    if (e.key === 'c' || e.key === 'C') { e.preventDefault(); await bar.continueLast(); }
    if (e.key === 't' || e.key === 'T') { weekOffset = 0; load(); }
    if (/^[1-9]$/.test(e.key)) {
      const f = favorites()[Number(e.key) - 1];
      if (f) { await startTimer(f); await bar.refresh(); }
    }
  });

  document.addEventListener('trackz:refresh', load);
  setInterval(paintLiveStamps, 1000);
  await load();
})().catch(err => {
  const root = document.querySelector('#viewRoot');
  if (root) root.innerHTML = `<div class="empty-timer"><h2>Couldn’t load the timer</h2><p>${esc(err.message || err)}</p></div>`;
  console.error(err);
});

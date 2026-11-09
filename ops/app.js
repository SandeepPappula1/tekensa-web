/* /ops — Tekensa's team pages. A plain script (no imports, no build step), like /home/app.js and copied from none
   of it. The same Supabase session as /home: a signed-in person reads only what RLS lets their staff row read.
   What each door shows, what it writes and what it never shows: ops/README.md. */
(() => {
  const cfg = window.DUMP_CONFIG;
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- the contract's words, in one place (phase2-ops-server builds the other side) ---------- */
  // which doors each staff role opens; the first is where the page lands
  const ROLE_DOORS = { founder: ['founder', 'ops', 'qa'], ops: ['ops'], qa: ['qa'] };
  const DOOR_NAME = { founder: 'today', ops: 'issues', qa: 'sort check' };
  // issues still in the queue, and the "mark" a person can set (status value → button word)
  const OPEN_STATUSES = ['open', 'triaged', 'fixing', 'verifying'];
  const MARKS = [['triaged', 'seen it'], ['fixing', 'on it'], ['closed', 'done']];
  const SEVERITIES = ['high', 'normal', 'low'];
  // dump_settings keys the founder door writes (values are text, like every row in that table)
  const PAUSE_KEYS = { instagram: 'pause_instagram', whatsapp: 'pause_whatsapp' };
  const CAP_KEY = 'model_daily_cap';
  // the QA "wrong" report: one thumbs-down issue per capture, carrying what was there and what it should be
  const reportArgs = (captureId, from, to) => ({ p_kind: 'thumbs_down', p_capture_id: captureId, p_detail: { field: 'category', from, to, source: 'web' } });
  const CATS = { travel: 'Travel', food: 'Food', shopping: 'Shopping', home: 'Home', kids: 'Kids', watch: 'Watch', fun: 'Fun', learn: 'Learn', docs: 'Documents', money: 'Money', photos: 'Photos', voice: 'Voice', ideas: 'Ideas', events: 'Events', later: 'Saved for later', unsorted: 'Not sorted yet' };
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  let session = null, role = null, door = null;
  const started = new Set();
  const ISSUES = new Map();
  let QA = [];

  /* ---------- small words ---------- */
  function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('on'), 2600); }
  const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString('en-IN'));
  function ago(ts) {
    const t = Date.parse(ts ?? ''); if (!Number.isFinite(t)) return '—';
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return s + ' s ago'; if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago'; return Math.round(s / 86400) + ' d ago';
  }
  /** Today, as India counts it (the caps and the "today" counts are India days on the server). */
  const indiaDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const httpsOnly = (u) => { try { const x = new URL(String(u ?? '')); return x.protocol === 'https:' ? x.href : ''; } catch { return ''; } };

  /* ---------- who is here ---------- */
  function showOnly(id) { for (const s of ['signed-out', 'not-staff', 'doors']) $('#' + s).hidden = s !== id; }

  async function boot() {
    const { data } = await sb.auth.getSession();
    session = data?.session ?? null;
    if (!session) { showOnly('signed-out'); return; }
    // a person with no staff row, or a role this page does not know, sees the one line and nothing is read
    let row = null;
    try { const r = await sb.from('staff').select('role').eq('user_id', session.user.id).maybeSingle(); if (!r.error) row = r.data; } catch {}
    role = row && Object.prototype.hasOwnProperty.call(ROLE_DOORS, row.role) ? row.role : null;
    if (!role) { showOnly('not-staff'); return; }
    showOnly('doors');
    $('#role-word').textContent = role;
    const doors = ROLE_DOORS[role];
    // a door this role does not open is never drawn, not even as a hidden tab
    for (const d of ['founder', 'ops', 'qa']) if (!doors.includes(d)) $('#d-' + d).remove();
    $('#doornav').innerHTML = doors.length > 1 ? doors.map((d) => `<button type="button" data-door="${d}">${esc(DOOR_NAME[d])}</button>`).join('') : '';
    openDoor(doors[0]);
  }

  function openDoor(d) {
    if (!ROLE_DOORS[role].includes(d)) return;
    door = d;
    for (const x of ROLE_DOORS[role]) $('#d-' + x).hidden = x !== d;
    document.querySelectorAll('[data-door]').forEach((b) => b.classList.toggle('on', b.dataset.door === d));
    if (d === 'founder') { void loadFounder(); if (!started.has('founder')) { started.add('founder'); startLive(); } }
    if (d === 'ops') void loadIssues('#o-issues', 'ops');
    if (d === 'qa') void loadQa();
  }

  /* ---------- founder: counts ---------- */
  async function loadFounder() { await Promise.all([loadCounts(), loadIssues('#f-issues', 'founder'), loadSettings()]); }

  async function loadCounts() {
    let data = null, error = null;
    try { ({ data, error } = await sb.rpc('ops_counts')); } catch (e) { error = e; }
    if (error || !data || typeof data !== 'object') { $('#f-asof').textContent = 'Could not count just now. Trying again in 30 s.'; return; }
    renderCounts(data);
  }

  const card = (key, n, label, sub, warn) => `<div class="card${warn ? ' warn' : ''}" data-card="${key}"><span class="n">${esc(n)}</span><span class="l">${esc(label)}</span>${sub ? `<span class="s">${esc(sub)}</span>` : ''}</div>`;

  function renderCounts(c) {
    const dev = c.devices ?? {}, caps = c.captures ?? {}, reads = c.reads ?? {}, f = c.funnel ?? {};
    const capTotal = Object.values(caps).reduce((a, v) => a + (Number(v) || 0), 0);
    const capWords = Object.entries(caps).filter(([, v]) => Number(v) > 0).map(([k, v]) => `${k} ${num(v)}`).join(' · ');
    const tickAge = Date.now() - Date.parse(c.last_tick_at ?? '');
    const readsToday = Number(reads.today), readsCap = Number(reads.cap);
    $('#f-asof').textContent = 'as of ' + new Date(c.as_of ?? Date.now()).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) + ' · every 30 s, and when something arrives';
    $('#f-cards').innerHTML = [
      card('devices', num(dev.total), 'devices', `${num(dev.seen_1h)} seen in the last hour · ${num(dev.seen_24h)} in 24 h`),
      card('captures', num(capTotal), 'captures', capWords),
      card('waiting', num(c.waiting_10m), 'waiting over 10 min', '', Number(c.waiting_10m) > 0),
      card('pushes', num(c.pushes_failed_today), 'pushes failed today', '', Number(c.pushes_failed_today) > 0),
      card('tick', ago(c.last_tick_at), 'last worker tick', '', !(tickAge < 5 * 60 * 1000)),
      card('reads', `${num(reads.today)} / ${num(reads.cap)}`, 'model reads today / cap', '', Number.isFinite(readsCap) && readsCap > 0 && readsToday >= readsCap),
      card('replies', num(c.replies_delivered_today), 'replies delivered today'),
      card('cost', c.cost_mtd_usd === null || c.cost_mtd_usd === undefined ? '—' : '$' + Number(c.cost_mtd_usd).toFixed(2), 'cost, month to date'),
    ].join('');

    const steps = [['senders', 'sent a DM'], ['linked', 'linked an account'], ['app', 'opened the app'], ['week4', 'came back in week 4']];
    const top = Number(f.senders) || 0;
    $('#f-funnel').innerHTML = steps.map(([k, label], i) => {
      const v = Number(f[k]), prev = i ? Number(f[steps[i - 1][0]]) : NaN;
      const of = i && prev > 0 && Number.isFinite(v) ? Math.round((v / prev) * 100) + '% of the step before' : '';
      const w = top > 0 && Number.isFinite(v) ? Math.min(100, Math.round((v / top) * 100)) : 0;
      return `<div class="step" data-step="${k}"><span>${esc(label)}</span><b>${esc(num(f[k]))}</b><span class="bar"><i style="width:${w}%"></i></span>${of ? `<small>${esc(of)}</small>` : ''}</div>`;
    }).join('');

    const pct = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : (Number(v) <= 1 ? Math.round(Number(v) * 100) : Math.round(Number(v))) + '%');
    $('#f-quality').innerHTML = card('gold', pct(c.gold_score), 'gold score') + card('unsorted', pct(c.unsorted_pct), 'not sorted');
    const corr = Object.entries(c.corrections_week ?? {}).sort((a, b) => Number(b[1]) - Number(a[1]));
    $('#f-corrections').innerHTML = corr.length
      ? corr.map(([k, v]) => `<span class="chip" data-corr="${esc(k)}">${esc(CATS[k] ?? k)} ${esc(num(v))}</span>`).join('')
      : '<span class="empty">no corrections this week</span>';
  }

  /* ---------- founder: live ---------- */
  let soonTimer = null, arrived = 0;
  function soon() { clearTimeout(soonTimer); soonTimer = setTimeout(() => { if (door === 'founder') void loadFounder(); }, 1500); }
  function startLive() {
    setInterval(() => { if (door === 'founder' && document.visibilityState !== 'hidden') void loadFounder(); }, 30000);
    // a count only: the payload of a capture is never read, let alone drawn
    try {
      sb.channel('ops-founder')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'captures' }, () => {
          arrived++; const p = $('#f-pulse'); if (p) { p.hidden = false; p.textContent = `${arrived} arrived since you opened this`; }
          soon();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'issues' }, () => soon())
        .subscribe();
    } catch {}
  }

  /* ---------- issues (founder and ops) ---------- */
  async function loadIssues(sel, mode) {
    const el = $(sel); if (!el) return;
    // the list reads no `detail` and no user: a title, a kind and counts. One row's evidence is issue_open's job.
    const { data, error } = await sb.from('issues').select('id, kind, source, capture_id, title, count, severity, status, first_seen_at, last_seen_at').in('status', OPEN_STATUSES).order('last_seen_at', { ascending: false }).limit(200);
    if (error) { el.innerHTML = `<p class="empty">Could not read the issues: ${esc(error.message)}</p>`; return; }
    const rows = data ?? [];
    for (const r of rows) ISSUES.set(r.id, r);
    if (mode === 'ops') $('#o-sub').textContent = rows.length ? `${rows.length} open · newest first within each severity` : 'nothing open';
    if (!rows.length) { el.innerHTML = '<p class="empty">No open issues.</p>'; return; }
    const rank = (s) => { const i = SEVERITIES.indexOf(s); return i < 0 ? SEVERITIES.length : i; };
    const groups = new Map();
    for (const r of [...rows].sort((a, b) => rank(a.severity) - rank(b.severity))) {
      const k = r.severity ?? 'unrated'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r);
    }
    el.innerHTML = [...groups].map(([sev, rs]) => `<h3 class="sevh">${esc(sev)} · ${rs.length}</h3>` + rs.map((r) => issueHtml(r, mode)).join('')).join('');
  }

  function actsHtml(r) {
    const marks = MARKS.map(([s, w]) => `<button type="button" class="chip${r.status === s ? ' on' : ''}" data-mark="${esc(r.id)}" data-status="${s}">${esc(w)}</button>`).join('');
    return marks + (r.capture_id ? `<button type="button" class="chip" data-requeue="${esc(r.capture_id)}">re-queue</button>` : '');
  }
  function issueHtml(r, mode) {
    const sev = r.severity ?? 'unrated';
    return `<div class="issue" data-issue="${esc(r.id)}">
      <div class="t"><span class="sev ${esc(sev)}">${esc(sev)}</span> ${esc(r.title)}</div>
      <div class="m">${esc(r.kind)} · ×${esc(num(r.count))} · first ${esc(ago(r.first_seen_at))} · last ${esc(ago(r.last_seen_at))} · ${esc(r.status)}</div>
      <div class="acts">${mode === 'ops' ? `<button type="button" class="chip" data-open-issue="${esc(r.id)}">open</button>` : ''}${actsHtml(r)}</div>
    </div>`;
  }

  async function mark(id, status) {
    const { error } = await sb.from('issues').update({ status }).eq('id', id);
    if (error) { toast('Not marked: ' + error.message); return; }
    const r = ISSUES.get(id); if (r) r.status = status;
    toast('Marked ' + status);
    await reloadIssueLists();
    if ($('#sheet').classList.contains('on') && $('#sheet').dataset.issue === id) void openIssue(id);
  }
  async function reloadIssueLists() {
    const jobs = [];
    if ($('#f-issues') && door === 'founder') jobs.push(loadIssues('#f-issues', 'founder'));
    if ($('#o-issues') && door === 'ops') jobs.push(loadIssues('#o-issues', 'ops'));
    await Promise.all(jobs);
  }
  async function requeue(captureId, btn) {
    if (btn) btn.disabled = true;
    const { data, error } = await sb.rpc('reprocess_capture', { p_id: captureId });
    if (btn) btn.disabled = false;
    if (error) { toast('Not re-queued: ' + error.message); return; }
    toast(data ? 'Re-queued: it will be read again' : 'Not now: it is already being read, or it cannot be re-queued from here');
  }

  /* ---------- ops: one row's evidence ---------- */
  async function openIssue(id) {
    const sh = $('#sheet');
    sh.dataset.issue = id;
    sh.innerHTML = '<p class="empty">Opening…</p>';
    sh.classList.add('on'); $('#scrim').classList.add('on');
    const { data, error } = await sb.rpc('issue_open', { p_issue: id });
    if (error || !data) { sh.innerHTML = `<div class="sp-h"><b>Could not open it</b><button type="button" class="x" data-close aria-label="Close">✕</button></div><p class="empty">${esc(error ? error.message : 'not found')}</p>`; return; }
    const got = Array.isArray(data) ? data[0] ?? {} : data;
    const r = got.issue ?? got;
    const evidence = got.evidence ?? r.evidence ?? null;
    if (r.id) ISSUES.set(r.id, { ...ISSUES.get(r.id), ...r });
    const detail = typeof r.detail === 'string' ? r.detail : r.detail ? JSON.stringify(r.detail, null, 2) : '';
    sh.innerHTML = `<div class="sp-h"><b>${esc(r.title)}</b><button type="button" class="x" data-close aria-label="Close">✕</button></div>
      <p class="fine">${esc(r.kind)} · ${esc(r.source ?? '')} · ${esc(r.severity ?? 'unrated')} · ${esc(r.status)} · ×${esc(num(r.count))} · first ${esc(ago(r.first_seen_at))} · last ${esc(ago(r.last_seen_at))}</p>
      <div class="acts chips">${actsHtml({ ...r, id: r.id ?? id })}</div>
      ${detail ? `<h5>detail</h5><pre>${esc(detail)}</pre>` : ''}
      <h5>evidence</h5>${evidence ? `<pre id="evidence">${esc(typeof evidence === 'string' ? evidence : JSON.stringify(evidence, null, 2))}</pre>` : '<p class="empty">none attached</p>'}
      <h5>draft a reply</h5>
      <p class="fine">Written here, copied, and sent by a person. This page sends nothing.</p>
      <textarea id="draft" placeholder="Hi — thanks for telling us…"></textarea>
      <div class="row"><button type="button" class="btn" data-copy-draft>copy</button></div>`;
  }
  function closeSheet() { $('#sheet').classList.remove('on'); $('#sheet').innerHTML = ''; delete $('#sheet').dataset.issue; $('#scrim').classList.remove('on'); closeSort(); }
  async function copyDraft() {
    const t = $('#draft'); if (!t) return;
    try { await navigator.clipboard.writeText(t.value); toast('Copied. Send it yourself.'); }
    catch { t.select(); toast('Select-all is done: copy it with your keyboard.'); }
  }

  /* ---------- founder: controls ---------- */
  let SETTINGS = new Map();
  async function loadSettings() {
    const { data, error } = await sb.from('dump_settings').select('key, value').in('key', [...Object.values(PAUSE_KEYS), CAP_KEY]);
    if (error) { $('#f-pause').innerHTML = `<span class="empty">Could not read the settings: ${esc(error.message)}</span>`; return; }
    SETTINGS = new Map((data ?? []).map((r) => [r.key, r.value]));
    $('#f-pause').innerHTML = Object.entries(PAUSE_KEYS).map(([ch, key]) => {
      const paused = SETTINGS.get(key) === 'true';
      const name = ch === 'instagram' ? 'Instagram' : 'WhatsApp';
      return `<button type="button" class="chip${paused ? ' warn' : ''}" data-pause="${ch}" data-paused="${paused}">${name}: ${paused ? 'paused · resume' : 'running · pause'}</button>`;
    }).join('');
    const cap = $('#f-cap'); if (cap && document.activeElement !== cap) cap.value = SETTINGS.get(CAP_KEY) ?? '';
  }
  async function writeSetting(key, value) {
    return sb.from('dump_settings').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  }
  async function togglePause(ch, paused) {
    const { error } = await writeSetting(PAUSE_KEYS[ch], paused ? 'false' : 'true');
    if (error) { toast('Not changed: ' + error.message); return; }
    toast(paused ? 'Resumed ' + ch : 'Paused ' + ch);
    await loadSettings();
  }
  async function saveCap() {
    const raw = $('#f-cap').value.trim(), msg = $('#f-cap-msg');
    if (!/^\d+$/.test(raw)) { msg.textContent = 'A whole number, 0 or more.'; return; }
    const { error } = await writeSetting(CAP_KEY, String(Number(raw)));
    msg.textContent = error ? 'Not saved: ' + error.message : `Saved: ${num(raw)} reads a day.`;
    if (!error) await loadSettings();
  }
  async function addStaff() {
    const id = $('#f-staff-id').value.trim(), r = $('#f-staff-role').value, msg = $('#f-staff-msg');
    if (!UUID.test(id)) { msg.textContent = 'That is not a user id (a uuid, 36 characters).'; return; }
    if (!['founder', 'ops', 'qa'].includes(r)) return;
    const { error } = await sb.from('staff').insert({ user_id: id, role: r });
    msg.textContent = error ? 'Not added: ' + error.message : `Added as ${r}.`;
    if (!error) $('#f-staff-id').value = '';
  }

  /* ---------- qa: the sort-check strip ---------- */
  const thumbPath = (r) => r.thumbnail ?? r.thumbnail_path ?? r.object_path ?? null;
  async function loadQa() {
    const day = indiaDay();
    const { data, error } = await sb.rpc('reading_sample', { p_day: day, p_n: 30 });
    if (error) { $('#q-sub').textContent = 'Could not read the sample: ' + error.message; $('#q-strip').innerHTML = ''; return; }
    QA = Array.isArray(data) ? data : [];
    const paths = [...new Set(QA.map(thumbPath).filter(Boolean))];
    const urls = new Map();
    if (paths.length) {
      try {
        const { data: signed } = await sb.storage.from('dump-media').createSignedUrls(paths, 600);
        for (const s of signed ?? []) if (s && s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
      } catch {}
    }
    $('#q-sub').textContent = QA.length ? `${QA.length} read on ${day}. Is each one filed where a person would look for it?` : `Nothing read on ${day} yet.`;
    $('#q-strip').innerHTML = QA.map((r) => {
      const src = httpsOnly(urls.get(thumbPath(r)));
      const tags = Array.isArray(r.tags) ? r.tags.slice(0, 6).join(', ') : '';
      return `<div class="srow" data-qa="${esc(r.capture_id)}"><div class="sthumb">${src ? `<img src="${esc(src)}" alt="">` : ''}</div>
        <div class="smain"><span class="st">${esc(r.title || 'untitled')}</span><span class="ss" data-cat>${esc(CATS[r.category] ?? r.category ?? 'no category')}</span>${tags ? `<span class="ss">${esc(tags)}</span>` : ''}</div>
        <button type="button" class="chip" data-wrong="${esc(r.capture_id)}">wrong →</button></div>`;
    }).join('');
  }
  let wrongId = null;
  function openWrong(id) {
    const r = QA.find((x) => x.capture_id === id); if (!r) return; wrongId = id;
    const pop = $('#sortpop');
    const chips = Object.keys(CATS).filter((c) => c !== 'unsorted').map((c) => `<button type="button" class="chip${r.category === c ? ' on' : ''}" data-pick-cat="${c}"${r.category === c ? ' disabled' : ''}>${esc(CATS[c])}</button>`).join('');
    pop.innerHTML = `<div class="sp-h"><b>${esc(String(r.title ?? '').slice(0, 80))}</b><button type="button" class="x" data-close aria-label="Close">✕</button></div><h5>it belongs under</h5><div class="sp-chips">${chips}</div>`;
    pop.classList.add('on'); $('#scrim').classList.add('on');
  }
  function closeSort() { $('#sortpop').classList.remove('on'); if (!$('#sheet').classList.contains('on')) $('#scrim').classList.remove('on'); wrongId = null; }
  async function pickCategory(cat) {
    const id = wrongId; const r = QA.find((x) => x.capture_id === id); if (!r || !CATS[cat]) return;
    closeSort();
    const from = r.category ?? null;
    // two writes, both always attempted: the correction teaches the reader, the issue puts it in the queue
    const c = await sb.from('corrections').insert({ capture_id: id, user_id: session.user.id, field: 'category', value: cat, source: 'web' });
    const i = await sb.rpc('report_issue', reportArgs(id, from, cat));
    if (c.error || i.error) { toast('Not all saved: ' + [c.error && 'correction: ' + c.error.message, i.error && 'issue: ' + i.error.message].filter(Boolean).join('; ')); }
    else toast('Corrected to ' + CATS[cat] + ' and reported');
    if (!c.error) {
      r.category = cat;
      const row = [...document.querySelectorAll('[data-qa]')].find((el) => el.dataset.qa === id);
      if (row) { row.classList.add('done'); const s = row.querySelector('[data-cat]'); if (s) s.textContent = CATS[cat] + ' (corrected)'; }
    }
  }

  /* ---------- one listener for every button (the CSP forbids inline handlers) ---------- */
  document.addEventListener('click', (e) => {
    const t = e.target instanceof HTMLElement ? e.target : null; if (!t) return;
    let b;
    if ((b = t.closest('[data-door]'))) return openDoor(b.dataset.door);
    if ((b = t.closest('[data-mark]'))) return void mark(b.dataset.mark, b.dataset.status);
    if ((b = t.closest('[data-requeue]'))) return void requeue(b.dataset.requeue, b);
    if ((b = t.closest('[data-open-issue]'))) return void openIssue(b.dataset.openIssue);
    if ((b = t.closest('[data-copy-draft]'))) return void copyDraft();
    if ((b = t.closest('[data-pause]'))) return void togglePause(b.dataset.pause, b.dataset.paused === 'true');
    if ((b = t.closest('[data-wrong]'))) return openWrong(b.dataset.wrong);
    if ((b = t.closest('[data-pick-cat]'))) return void pickCategory(b.dataset.pickCat);
    if (t.closest('[data-close]') || t.id === 'scrim') { if ($('#sortpop').classList.contains('on')) closeSort(); else closeSheet(); }
  });
  document.addEventListener('submit', (e) => {
    const f = e.target; if (!(f instanceof HTMLElement)) return;
    if (f.id === 'f-cap-form') { e.preventDefault(); void saveCap(); }
    if (f.id === 'f-staff-form') { e.preventDefault(); void addStaff(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeSort(); closeSheet(); } });

  sb.auth.onAuthStateChange((evt) => { if (evt === 'SIGNED_OUT') location.reload(); });
  void boot();
})();

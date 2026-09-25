/* moved out of the page on 2026-09-25 so the Content-Security-Policy can refuse inline scripts: a script injected into the page cannot run. */
/* ---------- client ---------- */
const cfg = window.DUMP_CONFIG;
const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
const $ = (s) => document.querySelector(s);
/* a link is followed only if it is http(s): a javascript: or data: URL kept as an item must never become a clickable href (security audit, 2026-09-25) */
const safeUrl = (u) => { try { const x = new URL(String(u ?? ''), location.href); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; } catch { return ''; } };
// a thumbnail that fails to load is removed; delegated, because the CSP forbids inline handlers
document.addEventListener('error', (e) => { if (e.target && e.target.tagName === 'IMG' && e.target.classList.contains('thumb')) e.target.remove(); }, true);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('on'), 2200); }
function hash(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

const CATS = { travel: 'Travel', food: 'Food', shopping: 'Shopping', home: 'Home', kids: 'Kids', watch: 'Watch', fun: 'Fun', learn: 'Learn', docs: 'Documents', photos: 'Photos', voice: 'Voice', ideas: 'Ideas', events: 'Events', later: 'Saved for later', unsorted: 'Not sorted yet' };
const SRCLABEL = { whatsapp: 'WhatsApp', instagram: 'Instagram', web: 'Web', app: 'App', youtube: 'YouTube', tiktok: 'TikTok', reddit: 'Reddit', spotify: 'Spotify' };

let session = null, ITEMS = [], SPACES = [], CORR = new Map(), layout = 'rails', openId = null, signedUrls = new Map();
let addKey = null, refreshTimer = null, refreshRuns = 0;   // T09 idempotency key per attempt; T10 live refresh while anything is in flight
// T10: a heartbeat every 20 s while the tab is visible: one tiny read (row count + latest change); a difference means
// something arrived from another door (WhatsApp, another device) or finished, and the page reloads its own view.
let heartbeatSeen = null;
const editing = () => { const a = document.activeElement; return !!(a && $('#sheet') && $('#sheet').contains(a) && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT')); };
async function heartbeat() {
  if (!session || document.visibilityState === 'hidden') return;
  const { data, count } = await sb.from('captures').select('updated_at', { count: 'exact' }).is('deleted_at', null).order('updated_at', { ascending: false }).limit(1);
  const seen = `${count ?? 0}:${data?.[0]?.updated_at ?? ''}`;
  // a change is applied only when nobody is mid-edit: a note being typed or a tag being added must never be wiped
  // by a rebuild; the sheet's own viewed_at write is also what bumps updated_at, so it is skipped (review, 2026-09-25)
  if (heartbeatSeen !== null && seen !== heartbeatSeen && !editing()) { await loadAll(); route(); if (openId) openItem(openId); }
  if (!editing()) heartbeatSeen = seen;
}
setInterval(() => { heartbeat().catch(() => {}); }, 20000);

/* ---------- data ---------- */
async function loadAll() {
  const [c, s, si, co] = await Promise.all([
    // a resend is marked (duplicate_of, 0016) but never hidden: a person who sent a thing twice did so on purpose (0019)
    sb.from('captures').select('id, corrected_fields, duplicate_of, kind, channel, platform, status, understanding, stage_error, original_text, original_url, caption, captured_at, title, category, tags, hashtags, shelves, complete, missing, entities, extracted_text, transcript, summary, confidence, facets, note, viewed_at').is('deleted_at', null).order('captured_at', { ascending: false }).limit(500),
    sb.from('spaces').select('id, name, note, sort').is('deleted_at', null).order('sort'),
    sb.from('space_items').select('space_id, capture_id, added_by, suggested'),
    // T02: corrections live in the capture's own columns now (0014); nothing to overlay
    Promise.resolve({ data: [] }),
  ]);
  if (c.error) { toast('Could not load: ' + c.error.message); return; }
  SPACES = s.data ?? [];
  const bySpace = new Map(); for (const r of si.data ?? []) { if (!bySpace.has(r.capture_id)) bySpace.set(r.capture_id, []); bySpace.get(r.capture_id).push(r.space_id); }
  CORR = new Map(); for (const r of co.data ?? []) { if (!CORR.has(r.capture_id)) CORR.set(r.capture_id, {}); CORR.get(r.capture_id)[r.field] = r.value; }
  ITEMS = (c.data ?? []).map((r) => toItem(r, bySpace.get(r.id) ?? [], CORR.get(r.id) ?? {}));
  // T10: while anything is still being read (a WhatsApp arrival, a reprocess, an add from another device), refresh on our own
  const inFlight = ITEMS.some((i) => ['received', 'preserved', 'extracting', 'understanding', 'classifying', 'indexing'].includes(i.status));
  clearTimeout(refreshTimer);
  const tick = async () => { refreshRuns++; if (editing()) { refreshTimer = setTimeout(tick, 5000); return; } await loadAll(); route(); if (openId) openItem(openId); };
  if (inFlight && refreshRuns < 120) { refreshTimer = setTimeout(tick, 5000); } else if (!inFlight) refreshRuns = 0;
}
function toItem(r, spaces, corr) {
  const p = r.platform, f = r.facets ?? {};
  // Lifted to `types.js` so `collection.html` gets the identical answer —
  // a second copy of this mapping is how a shelf and a collection start
  // disagreeing about what a thing is.
  const type = window.DUMP_TYPES.typeOf(r);
  const src = SRCLABEL[p] ? p : r.channel;
  return {
    id: r.id, type, src, title: corr.title ?? r.title ?? 'Kept', cat: corr.category ?? r.category ?? 'unsorted', tags: corr.tags ?? r.tags ?? [],
    ents: (r.entities ?? []).map((e) => [e.name, e.kind]), spaces, date: new Date(r.captured_at), sum: r.summary ?? null, url: r.original_url, conf: r.confidence == null ? null : Number(r.confidence),
    limited: r.understanding === 'reference', status: r.status, err: r.stage_error, text: r.original_text, caption: r.caption, ocr: r.kind === 'image' ? r.extracted_text : null, extracted: r.kind !== 'image' ? r.extracted_text : null, transcript: r.transcript,
    note: corr.note ?? r.note ?? '', image: f.link?.image ?? null, facets: f, corrected: (r.corrected_fields ?? []).length > 0 || Object.keys(corr).length > 0, viewedAt: r.viewed_at,
    correctedFields: r.corrected_fields ?? [], dup: r.duplicate_of ?? null, understanding: r.understanding, kind: r.kind,
    dates: Array.isArray(f.dates) ? f.dates : [], amounts: Array.isArray(f.amounts) ? f.amounts : [], entities: r.entities ?? [],
    // 0023: the shelver's rows, the person's own #tags, and the validator's verdict — all three are columns, never re-derived here
    shelves: r.shelves ?? [], hashtags: r.hashtags ?? [], complete: r.complete === true, missing: r.missing ?? [], form: f.form ?? null,
  };
}
async function mediaUrl(item) {
  if (item.image) return item.image;
  if (!['photo', 'video', 'voice', 'pdf', 'doc'].includes(item.type)) return null;
  if (signedUrls.has(item.id)) return signedUrls.get(item.id);
  const { data } = await sb.from('capture_media').select('object_path').eq('capture_id', item.id).eq('role', 'original').maybeSingle();
  if (!data) return null;
  const { data: s } = await sb.storage.from('dump-media').createSignedUrl(data.object_path, 600);
  const u = s?.signedUrl ?? null; signedUrls.set(item.id, u); return u;
}

/* ---------- canonical facts: the runner's own reads, formatted, never invented ---------- */
function fmtDate(iso) { const d = new Date(iso + 'T00:00:00'); if (isNaN(d)) return iso; const days = Math.round((d - new Date(new Date().toDateString())) / 864e5); const wd = d.toLocaleDateString('en-IN', { weekday: 'short' }); const dm = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); return days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : (days > 1 && days < 7) ? wd : `${wd} ${dm}`; }
function fmtAmount(a) { try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: a.currency, maximumFractionDigits: Number.isInteger(a.value) ? 0 : 2 }).format(a.value); } catch { return a.raw; } }
function factsOf(i) {
  const f = [];
  for (const d of i.dates.slice(0, 2)) f.push({ k: 'when', v: fmtDate(d.iso), t: d.raw });
  for (const a of i.amounts.slice(0, 2)) f.push({ k: 'amount', v: fmtAmount(a), t: a.raw });
  for (const e of i.entities.filter((e) => ['place', 'business', 'brand', 'product', 'event'].includes(e.kind)).slice(0, 3)) f.push({ k: e.kind, v: e.name });
  if (i.type === 'place' && i.facets.link?.domain) f.push({ k: 'map', v: i.facets.link.domain });
  return f;
}
const STATE_WORDS = { received: 'Received', preserved: 'Kept · reading soon', extracting: 'Reading…', understanding: 'Reading…', classifying: 'Organising…', indexing: 'Organising…', failed: 'Couldn’t read' };

/* ---------- posters (painted; real thumbnails when we have them) ---------- */
const ART = new Map();
function rnd(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function art(item) {
  if (ART.has(item.id)) return ART.get(item.id);
  // the design system, 2026-09-25: a poster with no thumbnail is painted from surface and accent-dim at an opacity
  // seeded per item, so two posters are never identical and no hue ever stands for a category
  const r = rnd(hash(item.id));
  const W = 360, H = 240, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  x.fillStyle = '#17171C'; x.fillRect(0, 0, W, H);
  for (let k = 0; k < 4; k++) { const cx = r() * W, cy = r() * H, rad = 80 + r() * 180; const g = x.createRadialGradient(cx, cy, 0, cx, cy, rad); g.addColorStop(0, `rgba(35,35,58,${.5 + r() * .5})`); g.addColorStop(1, 'rgba(35,35,58,0)'); x.fillStyle = g; x.fillRect(0, 0, W, H); }
  x.globalAlpha = .05; for (let k = 0; k < 500; k++) { x.fillStyle = r() > .5 ? '#fff' : '#000'; x.fillRect(r() * W, r() * H, 1.5, 1.5); } x.globalAlpha = 1;
  const url = `url(${c.toDataURL('image/jpeg', .8)}) center/cover`; ART.set(item.id, url); return url;
}
const SHAPE = { reel: 'vert', tiktok: 'vert', video: 'wide', post: 'sq', reddit: 'wide', place: 'wide', product: 'sq', photo: 'wide', pdf: 'sq', doc: 'sq', voice: 'wide', article: 'wide', note: 'sq', music: 'sq' };
const TITLED = new Set(['reel', 'tiktok', 'video', 'place', 'article', 'reddit', 'note', 'post', 'music']);
const PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
function posterHtml(item, big) {
  const t = item.type; let inner = ''; const ttl = `<div class="ttl">${esc(item.title)}</div>`;
  if (['reel', 'tiktok', 'video'].includes(t)) inner = `<span class="glyph">${PLAY}</span>${ttl}`;
  else if (t === 'pdf' || t === 'doc') inner = `<div class="page"><i></i><i></i><i></i><i></i><i></i><i></i></div>${t === 'pdf' ? '<span class="badge">PDF</span>' : ''}`;
  else if (t === 'voice') { const bars = Array.from({ length: big ? 60 : 28 }, (_, k) => `<i style="height:${20 + (hash(item.id + ':' + k) % 80)}%"></i>`).join(''); inner = `<div class="bars">${bars}</div>`; }
  else if (t === 'article' || t === 'reddit') inner = `<div class="ed"><small>${t}</small><b>${esc(item.title)}</b></div>`;
  else if (t === 'note') inner = `<div class="txt">${esc(item.title)}</div>`;
  else if (TITLED.has(t)) inner = ttl;
  const img = item.image ? `<img class="thumb" src="${esc(safeUrl(item.image))}" alt="" loading="lazy">` : '';
  const state = item.status && !['ready', 'limited', 'failed'].includes(item.status) ? `<div class="state"><span class="dot"></span>${esc(STATE_WORDS[item.status] ?? item.status)}</div>` : '';
  const cls = t === 'pdf' ? 'doc' : t === 'reddit' ? 'article' : t;
  return `<div class="poster p-${cls}" style="background:${art(item)}">${img}${inner}<div class="vig"></div>${state}</div>`;
}
function srcHtml(i) { return `<span class="src ${i.src}"><i></i>${SRCLABEL[i.src] ?? i.src}</span>`; }
function ago(d) { const n = Math.round((Date.now() - d) / 864e5); if (n <= 0) return 'today'; if (n === 1) return 'yesterday'; if (n < 7) return n + ' days ago'; if (n < 30) return Math.round(n / 7) + ' wk ago'; return Math.round(n / 30) + ' mo ago'; }
function cardHtml(i, opts = {}) {
  const shape = SHAPE[i.type] ?? 'sq';
  const flag = i.status === 'failed' ? `<span class="flag bad">couldn’t read</span>` : i.status === 'limited' && i.err ? `<span class="flag">${esc(i.err.replace(/^model unavailable: /, 'model down: ').slice(0, 28))}</span>` : i.limited ? `<span class="flag">reference only</span>` : '';
  const facts = factsOf(i).filter((x) => x.k === 'when' || x.k === 'amount').slice(0, 2);   // a card shows the two facts a person scans for; names stay in the sheet
  const factLine = facts.length ? `<span class="f">${facts.map((x) => esc(x.v)).join(' · ')}</span>` : '';
  return `<button class="card ${opts.grid ? '' : 's-' + shape} ${TITLED.has(i.type) ? 'titled' : ''} ${i.status === 'failed' ? 'failed' : ''}" draggable="true" data-id="${i.id}" aria-label="${esc(i.title)}">${posterHtml(i)}${flag}<div class="meta"><span class="t">${esc(i.title)}</span>${factLine}<span class="s">${srcHtml(i)} · ${ago(i.date)}${i.dup ? ' · sent again' : ''}</span></div></button>`;
}
function rail(title, items, why, link) { if (!items.length) return ''; return `<section class="rail"><div class="rail-h"><h2>${esc(title)}</h2>${why ? `<span class="why">${esc(why)}</span>` : ''}${link ? `<a href="${link}">see all ›</a>` : ''}</div><div class="track">${items.slice(0, 14).map((i) => cardHtml(i)).join('')}</div></section>`; }
// 5.2: a thing is a product when the reader named a product or a brand in it, or the link itself is a product page
const isProduct = (i) => i.form === 'product' || i.type === 'product' || i.entities.some((e) => e.kind === 'product' || e.kind === 'brand');
const namesEntity = (i, name) => i.entities.some((e) => String(e.name ?? '').toLowerCase() === name);
/* ---------- 3.7: one quiet line about the app under results; dismissed once, never shown again ---------- */
const INSTALL_KEY = 'tekensa.install.dismissed';
function installDismissed() { try { return localStorage.getItem(INSTALL_KEY) === '1'; } catch { return false; } }
function installLine() { return installDismissed() ? '' : `<p class="install-line"><span>Tekensa on your phone: reminders, camera, share sheet.</span><a href="/join/">get the app</a><button type="button" data-install-x aria-label="Not now">✕</button></p>`; }
function gridHtml(items) { return `<div class="grid">${items.map((i) => cardHtml(i, { grid: true })).join('')}</div>`; }
function spaceName(id) { return SPACES.find((s) => s.id === id)?.name ?? ''; }

/* ---------- views ---------- */
function renderHome() {
  const live = ITEMS;
  const h = new Date().getHours();
  $('#greet').innerHTML = `${h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'}.`;
  $('#greetsub').textContent = live.length ? `${live.length} thing${live.length > 1 ? 's' : ''} you didn't want to lose · organised for you.` : 'Send us anything you don’t want to lose.';
  const B = $('#home-body');
  if (!live.length) { B.innerHTML = `<div class="empty"><div><h1>Send us anything you don't want to lose.</h1><p>A link, a screenshot, a voice note, a PDF, a thought. Don't sort it. Just send it.</p><div class="ways"><div class="way"><b>+ add</b><small>Paste a link or text, or pick a file.</small></div><div class="way"><b>Instagram</b><small>DM anything to <a href="https://instagram.com/tekensa" target="_blank" rel="noopener">@tekensa</a>. The reply sends you a code; enter it at <a href="/login/?c=">tekensa.com/login</a> and it all lands here.</small></div><div class="way"><b>WhatsApp</b><small>Coming: the same, once the number is live.</small></div></div></div></div>`; return; }
  if (layout === 'grid') { B.innerHTML = gridHtml(live); return; }
  const processing = live.filter((i) => !['ready', 'limited'].includes(i.status));
  const parts = [
    processing.length ? `<p class="status-pill" style="margin:0 0 14px"><i></i>${processing.length === 1 ? 'one thing is being read' : processing.length + ' things are being read'}</p>` : '',
    rail('Recently added', live, 'newest first', '#/all'),
    ...SPACES.map((s) => rail(s.name, live.filter((i) => i.spaces.includes(s.id)), 'a Space you made', `#/s/${s.id}`)),
    ...Object.keys(CATS).filter((c) => c !== 'unsorted').map((c) => rail(CATS[c], live.filter((i) => i.cat === c), '', `#/c/${c}`)),
    // 0023: the shelver's rows. A reel is not a photo; a thing still being read is not hidden but named.
    ...Object.keys(LIST_LABEL).map((l) => rail(LIST_LABEL[l], live.filter((i) => i.shelves.includes('list:' + l)), LIST_WHY[l], `#/shelf/list:${l}`)),
    rail('Reels', live.filter((i) => i.shelves.includes('form:reel')), 'every reel you sent', '#/shelf/form:reel'),
    rail('Posts', live.filter((i) => i.shelves.includes('form:post')), 'shared posts', '#/shelf/form:post'),
    rail('Products', live.filter(isProduct), 'things that name a product or a brand', '#/products'),
    rail('Needs another look', live.filter((i) => !i.complete && ['ready', 'limited', 'failed'].includes(i.status)), 'kept, but something is still missing — Tekensa will try again', '#/shelf/incomplete'),
    ...topHashtags(live, 3).map((h) => rail('#' + h, live.filter((i) => i.hashtags.includes(h)), 'a tag you sent', `#/shelf/tag:${encodeURIComponent(h)}`)),
    rail('From WhatsApp', live.filter((i) => i.src === 'whatsapp'), 'forwarded to Tekensa', '#/src/whatsapp'),
    rail('From Instagram', live.filter((i) => i.src === 'instagram'), 'shared to Tekensa', '#/src/instagram'),
    rail('Not in any Space yet', live.filter((i) => !i.spaces.length), 'and that’s fine', '#/all'),
    rail('Not sorted yet', live.filter((i) => i.cat === 'unsorted'), 'Tekensa couldn’t place these; tap one to file it', '#/c/unsorted'),
  ];
  B.innerHTML = parts.join('');
}
function topHashtags(items, n) { const c = new Map(); for (const i of items) for (const h of i.hashtags) c.set(h, (c.get(h) ?? 0) + 1); return [...c.entries()].filter(([, k]) => k >= 2).sort((a, b) => b[1] - a[1]).slice(0, n).map(([h]) => h); }
/* ---------- day by day: every single thing, under the day it arrived; nothing filtered, nothing folded ---------- */
function dayKey(d) { return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); }
function dayLabel(key) { const d = new Date(key + 'T00:00:00+05:30'); const days = Math.round((new Date(dayKey(new Date()) + 'T00:00:00+05:30') - d) / 864e5); const long = d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined }); return days === 0 ? `Today · ${long}` : days === 1 ? `Yesterday · ${long}` : long; }
/* ---------- your lists: what you meant to do with what you sent, read from your own words ---------- */
const LIST_LABEL = { watch: 'to watch', go: 'places to go', eat: 'to eat and cook', buy: 'to buy', read: 'to read and learn', kids: 'for the kids', do: 'to do', bucket: 'bucket list' };
const LIST_WHY = { watch: 'trailers, films, series, "must watch"', go: 'places, hotels, trips, "want to go"', eat: 'restaurants, cafes, recipes, "must try"', buy: 'products, prices, "wishlist"', read: 'articles, books, courses', kids: 'anything for the little one', do: 'ideas, plans, "someday"', bucket: '"bucket list", "one day"' };
function renderLists() {
  const groups = Object.keys(LIST_LABEL).map((l) => [l, ITEMS.filter((i) => i.shelves.includes('list:' + l))]).filter(([, items]) => items.length);
  const n = groups.reduce((s, [, items]) => s + items.length, 0);
  $('#lists-sub').textContent = groups.length ? `${n} thing${n === 1 ? '' : 's'} across ${groups.length} list${groups.length === 1 ? '' : 's'}, read from your own words. Nothing here was filed by hand.` : 'Nothing on a list yet. Send a trailer with "must watch", a cafe with "when we go", a product with "to buy": the words beside the share become the list.';
  $('#lists-body').innerHTML = groups.map(([l, items]) => `<section class="rail"><div class="rail-h"><h2>${esc(LIST_LABEL[l])}</h2><span class="why">${esc(LIST_WHY[l])} · ${items.length}</span><a href="#/shelf/list:${l}">See all →</a></div><div class="track">${items.slice(0, 14).map((i) => cardHtml(i)).join('')}</div></section>`).join('');
}
function renderDays() {
  const groups = new Map();
  for (const i of ITEMS) { const k = dayKey(i.date); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); }
  const keys = [...groups.keys()].sort().reverse();
  $('#days-sub').textContent = ITEMS.length ? `${ITEMS.length} thing${ITEMS.length === 1 ? '' : 's'} over ${keys.length} day${keys.length === 1 ? '' : 's'}. Every one of them is here.` : 'Nothing yet. Send something and it appears under today.';
  $('#days-body').innerHTML = keys.map((k) => { const items = groups.get(k); const missing = items.filter((i) => !i.complete && ['ready', 'limited', 'failed'].includes(i.status)).length; return `<section class="rail day"><div class="rail-h"><h2>${esc(dayLabel(k))}</h2><span class="why">${items.length} thing${items.length === 1 ? '' : 's'}${missing ? ` · ${missing} still being completed` : ''}</span></div>${gridHtml(items)}</section>`; }).join('') || '<p class="empty-rail">Nothing yet.</p>';
}
function renderList(kind, key) {
  let items = ITEMS, title = 'Everything', sub = 'Every single thing you sent, newest first.';
  if (kind === 'shelf') {
    if (key === 'incomplete') { items = ITEMS.filter((i) => !i.complete && ['ready', 'limited', 'failed'].includes(i.status)); title = 'Needs another look'; sub = 'Kept and listed, but the agents could not finish every note. Each one says what is missing; Tekensa asks again on its own.'; }
    else { let k; try { k = decodeURIComponent(key); } catch { location.hash = '#/home'; return; } items = ITEMS.filter((i) => i.shelves.includes(k)); title = k.startsWith('list:') ? (LIST_LABEL[k.slice(5)] ?? k) : k.startsWith('tag:') ? '#' + k.slice(4) : k.startsWith('form:') ? { reel: 'Reels', post: 'Posts', story: 'Stories', video: 'Videos', photo: 'Photos', voice: 'Voice notes', document: 'Documents', article: 'Articles', note: 'Notes', place: 'Places', product: 'Products', music: 'Music' }[k.slice(5)] ?? k : k; sub = 'A shelf the filer keeps. Nothing here was placed by hand.'; }
  }
  if (kind === 'c') { items = ITEMS.filter((i) => i.cat === key); title = CATS[key] ?? key; sub = 'A collection Tekensa keeps for you. Nothing here was filed by hand.'; }
  if (kind === 'src') { items = ITEMS.filter((i) => i.src === key); title = 'From ' + (SRCLABEL[key] ?? key); sub = ''; }
  if (kind === 'products') { items = ITEMS.filter(isProduct); title = 'Products'; sub = 'Everything that names a product or a brand, as the reader found them.'; }
  if (kind === 'entity') {
    // 5.2: a shelf for one named product or brand; the name comes from the address and is only ever compared, never rendered raw
    let name; try { name = decodeURIComponent(key ?? '').trim().toLowerCase(); } catch { location.hash = '#/home'; return; }
    if (!name) { location.hash = '#/home'; return; }
    items = ITEMS.filter((i) => namesEntity(i, name)); const shown = items.flatMap((i) => i.entities).find((e) => String(e.name ?? '').toLowerCase() === name);
    title = shown ? shown.name : name; sub = 'Everything you sent that names it.';
  }
  $('#list-title').textContent = title; $('#list-sub').textContent = `${sub} ${items.length} thing${items.length === 1 ? '' : 's'}.`;
  $('#list-body').innerHTML = items.length ? gridHtml(items) : '<p class="empty-rail">Nothing here yet.</p>';
}
function renderSpaces() {
  $('#spaces-grid').innerHTML = SPACES.map((s) => { const items = ITEMS.filter((i) => i.spaces.includes(s.id)); return `<a class="space" href="#/s/${s.id}" data-space="${s.id}"><div class="mos">${items.slice(0, 3).map((i) => `<i style="background:${art(i)}"></i>`).join('')}${'<i style="background:var(--raise)"></i>'.repeat(Math.max(0, 3 - items.length))}</div><h3>${esc(s.name)}</h3><small>${items.length} things${s.note ? ' · ' + esc(s.note) : ''}</small></a>`; }).join('') + `<button class="space newbtn" id="newspace"><span style="font-size:28px;line-height:1">+</span>new space</button>`;
  $('#spaces-pool').innerHTML = ITEMS.filter((i) => !i.spaces.length).slice(0, 14).map((i) => cardHtml(i)).join('');
}
function renderSpace(id) {
  const s = SPACES.find((x) => x.id === id); if (!s) { location.hash = '#/spaces'; return; }
  const items = ITEMS.filter((i) => i.spaces.includes(id));
  $('#space-title').textContent = s.name; $('#space-sub').textContent = `${items.length} things${s.note ? ' · ' + s.note : ''}.`;
  $('#space-body').innerHTML = items.length ? gridHtml(items) : '<p class="empty-rail">Nothing here yet. Drag something up from below.</p>';
  $('#space-pool').innerHTML = ITEMS.filter((i) => !i.spaces.includes(id)).slice(0, 20).map((i) => cardHtml(i)).join('');
  $('#space-rename').onclick = async () => { const n = prompt('Rename Space', s.name); if (!n?.trim()) return; const { error } = await sb.from('spaces').update({ name: n.trim() }).eq('id', id); if (error) return toast(error.message); s.name = n.trim(); renderSpace(id); toast('Renamed'); };
  $('#space-delete').onclick = async () => { if (!confirm(`Delete "${s.name}"? Nothing inside is deleted; it stays in your collection.`)) return; const { error } = await sb.from('spaces').update({ deleted_at: new Date().toISOString() }).eq('id', id); if (error) return toast(error.message); await loadAll(); location.hash = '#/spaces'; toast('Space deleted, things kept'); };
}
async function addToSpace(itemId, spaceId) {
  const i = ITEMS.find((x) => x.id === itemId); if (!i) return;
  if (i.spaces.includes(spaceId)) return toast('Already in ' + spaceName(spaceId));
  const { error } = await sb.from('space_items').insert({ space_id: spaceId, capture_id: itemId });
  if (error) return toast(error.message);
  i.spaces.push(spaceId); toast('Added to ' + spaceName(spaceId)); route();
}
async function removeFromSpace(itemId, spaceId) {
  const { error } = await sb.from('space_items').delete().eq('space_id', spaceId).eq('capture_id', itemId);
  if (error) return toast(error.message);
  const i = ITEMS.find((x) => x.id === itemId); i.spaces = i.spaces.filter((s) => s !== spaceId); toast('Removed from ' + spaceName(spaceId)); route();
}
async function newSpace(withItem) {
  const n = prompt('Name your Space', ''); if (!n?.trim()) return null;
  const { data, error } = await sb.from('spaces').insert({ user_id: session.user.id, name: n.trim() }).select('id, name, note, sort').single();
  if (error) { toast(error.message); return null; }
  SPACES.push(data); if (withItem) await addToSpace(withItem, data.id); toast('Space created'); return data.id;
}

/* ---------- item sheet ---------- */
async function openItem(id) {
  const i = ITEMS.find((x) => x.id === id); if (!i) return; openId = id;
  if (!i.viewedAt) { i.viewedAt = new Date().toISOString(); sb.from('captures').update({ viewed_at: i.viewedAt }).eq('id', id).then(() => {}); }
  const [{ data: obs }, { data: runs }] = await Promise.all([
    sb.from('observations').select('stage, producer, kind, value, confidence, evidence').eq('capture_id', id).order('created_at'),
    sb.from('agent_runs').select('attempt, agent, ok, duration_ms, note_count, error, at').eq('capture_id', id).order('at'),
  ]);
  const media = await mediaUrl(i);
  const O = obs ?? [];
  const has = (producer, kind) => O.find((o) => o.producer === producer && o.kind === kind);

  // ---- lifecycle: each step lit only by what the row proves ----
  const inFlight = ['received', 'preserved', 'extracting', 'understanding', 'classifying', 'indexing'].includes(i.status);
  const kept = !!media || !!i.text || !!i.url;
  const readWord = i.understanding === 'full' ? 'Read' : i.understanding === 'metadata' ? 'Read partly' : i.understanding === 'reference' ? 'Kept as reference' : 'Read';
  const modelDown = /^model unavailable/.test(i.err ?? '');
  const steps = [
    { l: 'Received', on: true },
    { l: kept ? 'Kept' : 'Keeping', on: kept || i.status !== 'received', now: i.status === 'received' && !kept },
    { l: i.status === 'failed' ? 'Couldn’t read' : modelDown ? 'Model unavailable' : readWord, on: !inFlight && i.status !== 'failed' && !!i.understanding, now: ['preserved', 'extracting', 'understanding'].includes(i.status), fail: i.status === 'failed', warn: modelDown },
    { l: i.correctedFields.includes('category') ? 'You filed it' : 'Organised', on: !inFlight && i.status !== 'failed' && !!i.cat && i.cat !== 'unsorted' || i.correctedFields.includes('category'), now: ['classifying', 'indexing'].includes(i.status) },
    { l: 'Findable', on: ['ready', 'limited'].includes(i.status) },
  ];
  const lcNote = i.status === 'failed' ? esc(i.err ?? 'reading failed') : modelDown ? esc(i.err) + ' — Tekensa will try again' : i.status === 'limited' && i.err ? esc(i.err) : i.limited ? (i.type === 'reel' || i.type === 'post' || i.src === 'instagram' ? 'this platform does not let Tekensa read the content; the link is kept' : 'the page did not answer, so only the link is kept') : '';
  const lifecycle = `<div class="lc">${steps.map((st) => `<span class="${st.fail ? 'fail' : st.now ? 'now' : st.warn ? 'warn' : st.on ? 'done' : ''}"><i></i>${st.l}</span>`).join('')}${lcNote ? `<span class="lcnote">${lcNote}</span>` : ''}</div>`;

  // ---- canonical header: title, the facts the runner produced, the summary ----
  const facts = factsOf(i);
  const factsHtml = facts.length ? `<div class="facts">${facts.map((x) => `<span class="fact"><small>${esc(x.k)}</small><b>${esc(x.v)}</b>${x.t && x.t !== x.v ? `<em title="as written">${esc(x.t)}</em>` : ''}</span>`).join('')}</div>` : '';
  const prov = `<div class="prov"><span>${srcHtml(i)}</span><span>${esc(i.type)}</span><span>saved <b>${i.date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</b> · ${ago(i.date)}</span>${i.conf != null && !i.correctedFields.length ? `<span>confidence <b>${Math.round(i.conf * 100)}%</b></span>` : ''}</div>`;

  // ---- evidence: the original, verbatim, and the text read from inside it ----
  const perma = safeUrl(i.facets?.ig?.permalink ?? null);
  const orig = i.url ? `<div class="orig"><div class="o"><b>Original link</b><small>${esc(i.url)}</small></div>${safeUrl(i.url) ? `<a class="btn y" href="${esc(safeUrl(i.url))}" target="_blank" rel="noopener">Open ↗</a>` : ''}</div>`
    : media && i.type === 'photo' ? `<div class="orig"><div class="o"><b>Original photo</b><small>kept exactly as sent</small></div><a class="btn y" href="${esc(media)}" target="_blank" rel="noopener">Open</a></div>`
    : media && i.type === 'voice' ? `<div class="orig"><div class="o"><b>Original recording</b><audio controls src="${esc(media)}"></audio></div></div>`
    : media && i.type === 'video' ? `<div class="orig"><div class="o"><b>Original video</b><video controls src="${esc(media)}" preload="metadata"></video></div></div>`
    : media && i.type === 'pdf' ? `<div class="orig"><div class="o"><b>Original document</b><small>kept exactly as sent</small></div><a class="btn y" href="${esc(media)}" target="_blank" rel="noopener">Open</a></div><iframe class="pdfview" src="${esc(media)}#view=FitH" title="${esc(i.title)}" loading="lazy"></iframe>`
    : media ? `<div class="orig"><div class="o"><b>Original file</b><small>kept exactly as sent</small></div><a class="btn y" href="${esc(media)}" target="_blank" rel="noopener">Open</a></div>`
    // a shared reel or post whose file Meta did not hand over: the words are here, the thing itself plays on Instagram
    : perma ? `<div class="orig"><div class="o"><b>${i.form === 'post' ? 'Post' : 'Reel'} on Instagram</b><small>the ${i.form === 'post' ? 'post' : 'video'} stays on Instagram; its words are kept here</small></div><a class="btn y" href="${esc(perma)}" target="_blank" rel="noopener">Open ↗</a></div>`
    : i.text ? `<div class="orig words"><div class="o"><b>Your words</b><small>${esc(i.text)}</small></div></div>`
    : i.status === 'received' ? `<div class="orig"><div class="o"><b>Arriving</b><small>the original is being kept</small></div></div>`
    : `<div class="orig"><div class="o"><b>Original not available</b><small>${esc(i.facets?.wa?.fetch_error ?? 'the file could not be fetched from the channel; the reference is kept')}</small></div></div>`;
  const reader = has('pdf-text', 'extracted_text') ? 'from the document’s own text layer' : has('file-text', 'extracted_text') ? 'from the file' : has('readability', 'extracted_text') ? 'from the page' : has('model', 'extracted_text') ? 'read by the model' : null;
  const inside = i.ocr || i.extracted ? `<div class="sec"><h4>Text inside it${reader ? ` <span class="conf">· ${reader}</span>` : ''}</h4><p class="verbatim">${esc((i.ocr || i.extracted).slice(0, 1400))}${(i.ocr || i.extracted).length > 1400 ? '…' : ''}</p></div>` : '';
  const tr = has('transcriber', 'transcript') || has('whisper', 'transcript');
  const transcript = i.transcript ? `<div class="sec"><h4>Transcript${tr?.evidence ? ` <span class="conf">· ${esc(tr.evidence)}${tr.confidence != null ? ` · ${Math.round(tr.confidence * 100)}%` : ''}</span>` : ''}</h4><p class="verbatim serif">“${esc(i.transcript)}”</p></div>` : '';

  // ---- understanding: every observation as a sentence, deterministic first, the model second ----
  const say = (o) => {
    const v = o.value, conf = o.confidence != null && o.confidence > 0 ? `<span class="conf">${Math.round(o.confidence * 100)}%</span>` : '';
    const ev = o.evidence ? `<span class="conf">${esc(o.evidence)}</span>` : '';
    if (o.kind === 'platform' && v && typeof v === 'object') return `Recognised the link: <b>${esc(v.platform ?? 'web')}</b>${v.label ? `, a ${esc(v.label)}` : ''}${v.fetchable === false ? ' — a host Tekensa does not open' : ''}`;
    if (o.kind === 'preview') return v && v.none ? `Asked the page for its title; <b>no answer</b> ${ev}` : `Read the page’s title${v && v.description ? ' and description' : ''}${v && v.image ? ', and its image' : ''}`;
    if (o.kind === 'extracted_text') return v && v.none ? `Looked for text inside: <b>none</b> ${ev}` : `Read the text inside ${ev}`;
    if (o.kind === 'reference-only') return `Did not open it: ${ev || 'a login-walled host'}`;
    if (o.kind === 'refused') return `Kept as sent and <b>not read</b>: it looked like a password or a code`;
    if (o.kind === 'dates') return `Found ${Array.isArray(v) ? v.length : 1} date${Array.isArray(v) && v.length !== 1 ? 's' : ''}: ${esc((v ?? []).map((d) => d.raw).join(', '))}`;
    if (o.kind === 'amounts') return `Found ${Array.isArray(v) ? v.length : 1} amount${Array.isArray(v) && v.length !== 1 ? 's' : ''}: ${esc((v ?? []).map((a) => a.raw).join(', '))}`;
    if (o.kind === 'contacts') return `Counted contact details (kept out of the index) ${ev}`;
    if (o.kind === 'place') return `Named the place from the link: <b>${esc(v)}</b>`;
    if (o.kind === 'description') return `Sees: <i>${esc(v)}</i> ${conf}`;
    if (o.kind === 'entities') return `Named: ${esc((v ?? []).map((e) => `${e.name} (${e.kind})`).join(', '))} ${conf}`;
    if (o.kind === 'transcript') return `Transcribed it ${ev} ${conf}`;
    if (o.kind === 'category' && o.producer === 'rules') { const why = String(o.evidence ?? '').replace(/[a-z]+\+\d+:/g, '·').split('·').map((r) => r.trim()).filter(Boolean).slice(0, 4); return v === 'unsorted' ? `Nothing in the words pointed to a shelf, so it is <b>not sorted yet</b>` : `Filed under <b>${esc(CATS[v] ?? v)}</b>${why.length ? ` because of: ${esc(why.join(', '))}` : ''} ${conf}`; }
    if (o.kind === 'category') return `Would file it under <b>${esc(CATS[v] ?? v)}</b> ${conf}`;
    if (o.kind === 'tags') return `Tagged: ${esc((v ?? []).join(', '))} ${conf}`;
    if (o.kind === 'hashtags') return `Kept the hashtags it came with: ${esc((v ?? []).map((h) => '#' + h).join(' '))}`;
    if (o.kind === 'mentions') return `Noted the handles: ${esc((v ?? []).map((h) => '@' + h).join(' '))} ${ev}`;
    if (o.kind === 'shelves') return `Put it on ${(v ?? []).length} shelves ${ev}`;
    if (o.kind === 'lists') return `On your ${esc((v ?? []).map((l) => LIST_LABEL[l] ?? l).join(' and '))} list${(v ?? []).length > 1 ? 's' : ''} ${ev}`;
    if (o.kind === 'validation') return v && v.complete ? `Checked: <b>nothing missing</b> (${esc((v.passed ?? []).join(', '))})` : `Checked: still missing <b>${esc((v && v.missing ? v.missing : []).join(', '))}</b> ${ev}`;
    if (o.kind === 'title') { const how = { 'og:title': 'from the page’s own title', 'first line': 'from the first line of the words', transcript: 'from the transcript', kept: 'kept the title it came with', fallback: 'from the file name or the address' }[o.evidence] ?? ''; return `Titled it ${how}`; }
    return `${esc(o.kind)}: ${esc(typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 160)} ${conf}`;
  };
  // 0023: the agents' own record — who ran, in which attempt, how long, and whether it finished
  const AGENT_WORDS = { extractor: 'Extractor', hashtagger: 'Hashtagger', reader: 'Reader', filer: 'Filer', shelver: 'Shelver', indexer: 'Indexer', validator: 'Validator' };
  const R = runs ?? [];
  const lastAttempt = R.length ? Math.max(...R.map((r) => r.attempt)) : 0;
  const agentsHtml = R.length ? `<div class="sec"><h4><span class="truth ob">The agents</span> attempt ${lastAttempt}${R.some((r) => r.attempt !== lastAttempt) ? ` of ${new Set(R.map((r) => r.attempt)).size}` : ''}</h4><div class="lc">${R.filter((r) => r.attempt === lastAttempt).map((r) => `<span class="${r.ok ? 'done' : 'fail'}" title="${esc(r.error ?? '')}"><i></i>${esc(AGENT_WORDS[r.agent] ?? r.agent)} · ${r.note_count} note${r.note_count === 1 ? '' : 's'} · ${r.duration_ms} ms${r.ok ? '' : ' · failed'}</span>`).join('')}</div>${i.complete ? '' : i.missing.length ? `<p class="conf" style="margin:8px 0 0">Still missing: <b>${esc(i.missing.join(', '))}</b>. Tekensa asks the agents again on its own.</p>` : ''}</div>` : '';
  const det = O.filter((o) => o.producer !== 'model' && o.producer !== 'transcriber' && o.producer !== 'whisper');
  const mod = O.filter((o) => o.producer === 'model' || o.producer === 'transcriber' || o.producer === 'whisper');
  const understanding = `<div class="sec"><h4><span class="truth ob">Observed</span> read exactly, by rules</h4><ul class="obs">${det.length ? det.map((o) => `<li>${say(o)}</li>`).join('') : '<li>nothing beyond the item itself</li>'}</ul></div>
    <div class="sec"><h4><span class="truth ai">Tekensa thinks</span> inferred by the model, may be wrong</h4>${i.sum ? `<p class="understand">${esc(i.sum)}</p>` : ''}<ul class="obs">${mod.length ? mod.map((o) => `<li>${say(o)}</li>`).join('') : `<li>${inFlight ? 'not yet' : modelDown ? 'the model could not be reached; Tekensa will try again' : 'no model read for this one'}</li>`}</ul></div>`;

  // ---- organisation: category, words, Spaces, and what this connects to (data already loaded) ----
  const tagSet = new Set(i.tags), entSet = new Set(i.ents.map((e) => e[0].toLowerCase()));
  const connected = ITEMS.filter((o) => o.id !== i.id).map((o) => {
    const why = [];
    if (o.dup === i.id || (i.dup && (o.id === i.dup || o.dup === i.dup))) why.push('the same thing, sent again');
    const shared = o.tags.filter((t) => tagSet.has(t)); if (shared.length) why.push('shares ' + shared.slice(0, 2).join(', '));
    const sharedEnt = o.ents.filter((e) => entSet.has(e[0].toLowerCase())); if (sharedEnt.length) why.push('mentions ' + sharedEnt[0][0]);
    const sharedSpace = o.spaces.filter((sp) => i.spaces.includes(sp)); if (sharedSpace.length) why.push('in ' + spaceName(sharedSpace[0]));
    return why.length ? { o, why: why[0], w: why.length + (why[0].startsWith('the same') ? 10 : 0) } : null;
  }).filter(Boolean).sort((a, b) => b.w - a.w).slice(0, 8);
  const connectedHtml = connected.length ? `<div class="sec"><h4><span class="truth ob">Connected</span> by what they share</h4><div class="track">${connected.map(({ o, why }) => cardHtml(o).replace('<div class="meta">', `<div class="meta"><span class="why">${esc(why)}</span>`)).join('')}</div></div>` : '';
  const organisation = `<div class="sec"><h4><span class="truth ${i.correctedFields.includes('category') ? 'you' : 'ai'}">${i.correctedFields.includes('category') ? 'You decided' : 'Tekensa filed'}</span> ${i.correctedFields.includes('category') ? 'this stays where you put it' : 'tap to move it'}</h4>
      <div class="corr">${Object.keys(CATS).map((c) => `<button class="${i.cat === c ? 'on' : ''}" data-setcat="${c}">${CATS[c]}</button>`).join('')}</div>
      <div class="tags" style="margin-top:10px">${i.hashtags.map((h) => `<a class="tag" href="#/shelf/tag:${encodeURIComponent(h)}" title="a hashtag you sent">#${esc(h)}</a>`).join('')}${i.tags.filter((t) => !i.hashtags.includes(t)).map((t) => `<span class="tag">${esc(t)}<span class="x" data-rmtag="${esc(t)}" title="remove">✕</span></span>`).join('')}${i.ents.map((e) => (e[1] === 'product' || e[1] === 'brand') ? `<a class="tag ent" href="#/entity/${encodeURIComponent(e[0])}" title="${esc(e[1])} · everything that names it" data-ent>${esc(e[0])} ›</a>` : `<span class="tag ent" title="${esc(e[1])}">${esc(e[0])}</span>`).join('')}<span class="addtag"><input id="addtag-in" placeholder="add a word"><button class="tag" id="addtag-go">add</button></span></div></div>
    <div class="sec"><h4><span class="truth you">Yours</span> Spaces</h4><div class="spacerow">${SPACES.map((s) => `<button class="${i.spaces.includes(s.id) ? 'in' : ''}" data-tog="${s.id}">${i.spaces.includes(s.id) ? '✓ ' : '+ '}${esc(s.name)}</button>`).join('')}<button data-newspace>+ New Space</button></div></div>${connectedHtml}<div class="sec" id="related" hidden></div>`;

  const hero = i.type === 'photo' && media ? `<div class="hero"><img class="thumb" src="${esc(media)}" alt=""><button class="x" id="sheetx" aria-label="Close">✕</button></div>` : `<div class="hero ${SHAPE[i.type] ?? 'sq'}" style="--hero-bg:${art(i)}">${posterHtml({ ...i, status: null }, true)}<button class="x" id="sheetx" aria-label="Close">✕</button></div>`;
  $('#sheet').innerHTML = `${hero}<div class="body">
    <div class="canon"><h2>${esc(i.title)}</h2>${factsHtml}${i.sum ? `<p class="understand">${esc(i.sum)}</p>` : ''}${prov}</div>
    ${lifecycle}
    <div class="band"><h3>Evidence</h3></div>${orig}${i.caption ? `<div class="sec"><h4>Your caption</h4><p style="margin:0">${esc(i.caption)}</p></div>` : ''}${inside}${transcript}
    <div class="band"><h3>Understanding</h3></div>${agentsHtml}${understanding}
    <div class="band"><h3>Organisation</h3></div>${organisation}
    <div class="band"><h3>Yours</h3></div>
    <div class="sec"><h4>your note</h4><textarea class="note" placeholder="Anything you want to remember about this…" data-note="${i.id}">${esc(i.note)}</textarea><p class="conf" style="margin:6px 0 0">saved when you leave the box</p></div>
    <div class="sec acts"><div class="row" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${(i.status === 'limited' || i.status === 'failed') ? `<button class="btn" data-reread="${i.id}">read again</button><span class="fine">Runs the reading steps once more. Your own edits are kept.</span>` : ''}</div>
      <div class="row" style="margin-top:10px;display:flex;gap:8px;align-items:center"><button class="btn" data-del="${i.id}">delete</button><span id="del-confirm" hidden><span class="fine">Delete this one thing? </span><button class="btn y" data-del-go="${i.id}">delete it</button> <button class="btn" data-del-no>keep</button></span></div></div>
  </div>`;
  $('#sheet').classList.add('on'); $('#scrim').classList.add('on'); $('#sheet').scrollTop = 0;
  loadRelated(id);
}
// 8.4: what the index holds next to this one, asked of the server after the sheet is up; nothing shown when it has nothing or fails
async function loadRelated(id) {
  let rows;
  try { const { data, error } = await sb.rpc('related_captures', { p_id: id, p_limit: 5 }); if (error) return; rows = Array.isArray(data) ? data : []; } catch { return; }
  const el = $('#related'); if (!el || openId !== id) return;
  const byId = new Map(ITEMS.map((i) => [i.id, i]));
  const found = rows.map((r) => ({ r, i: byId.get(String(r.id)) })).filter((x) => x.i && x.i.id !== id).slice(0, 5);
  if (!found.length) return;
  el.innerHTML = `<h4><span class="truth ob">Related</span> by what the index knows</h4><div class="track">${found.map(({ r, i }) => cardHtml(i).replace('<div class="meta">', `<div class="meta"><span class="why">${esc(CATS[r.category] ?? r.category ?? '')}</span>`)).join('')}</div>`;
  el.hidden = false;
}
async function renderChannels() {
  const el = $('#you-channels'); if (!el) return;
  const { data, error } = await sb.from('channel_identities').select('id, channel, display_name, claimed_at').order('claimed_at', { ascending: true });
  if (error) { el.textContent = 'Could not look right now.'; return; }
  if (!data || !data.length) { el.innerHTML = 'Nothing linked yet. DM anything to <a href="https://instagram.com/tekensa" target="_blank" rel="noopener">@tekensa</a> and enter the code at <a href="/login/?c=">tekensa.com/login</a>.'; return; }
  el.innerHTML = data.map((c) => `<span class="chip">${esc(c.channel)}${c.display_name ? ' · ' + esc(c.display_name) : ''}</span> <button class="btn" data-unlink="${c.id}">unlink</button>`).join('<br>') + '<br><small class="fine">Unlinking keeps everything you already sent. New messages from that account are treated as a stranger\'s again until it is linked.</small>';
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-unlink]'); if (!b) return;
  if (!confirm('Unlink this channel? What you sent stays. New messages from it will not land here until you link again.')) return;
  const { data, error } = await sb.rpc('unlink_channel_identity', { p_identity: b.dataset.unlink });
  if (error || !data || data.ok !== true) { toast('Could not unlink right now.'); return; }
  toast('Unlinked'); renderChannels();
});
// a password, set from inside a signed-in session: no email round trip (founder, 25 Sep 2026)
$('#you-pass-go').addEventListener('click', async () => {
  const msg = $('#you-pass-msg'); msg.textContent = '';
  const password = $('#you-pass').value;
  if (password.length < 8) { msg.textContent = 'Eight characters or more.'; return; }
  const { error } = await sb.auth.updateUser({ password });
  if (error) { msg.textContent = error.message; return; }
  $('#you-pass').value = '';
  msg.textContent = 'Saved. Next time, sign in with your email and this password.';
});
async function renderAudit() {
  const el = $('#you-audit'); if (!el) return;
  const { data, error } = await sb.rpc('account_audit');
  if (error || !data) { el.textContent = 'Could not count right now.'; return; }
  const n = (k) => Number(data[k] ?? 0);
  el.innerHTML = `<b>${n('total')}</b> thing${n('total') === 1 ? '' : 's'} over <b>${n('days')}</b> day${n('days') === 1 ? '' : 's'}. <b>${n('complete')}</b> complete, <b>${n('incomplete')}</b> still being completed${n('in_flight') ? `, <b>${n('in_flight')}</b> being read right now` : ''}${n('retrying') ? `, <b>${n('retrying')}</b> waiting to be read again` : ''}${n('failed') ? `, <b>${n('failed')}</b> could not be read` : ''}. Nothing is left out of these counts.`;
}
function closeSheet() { $('#sheet').classList.remove('on'); $('#scrim').classList.remove('on'); openId = null; }
async function correct(item, field, value) {
  const { error } = await sb.from('corrections').insert({ capture_id: item.id, user_id: session.user.id, field, value });
  if (error) return toast(error.message);
  if (!CORR.has(item.id)) CORR.set(item.id, {}); CORR.get(item.id)[field] = value; item.corrected = true;
  if (field === 'category') item.cat = value; if (field === 'tags') item.tags = value; if (field === 'title') item.title = value;
}

/* ---------- ask ---------- */
const TRIES = ['What did I save about Japan?', 'Show me the places I saved', 'What did I add last week?', 'Things not in any Space', 'Documents', 'What did I save from Instagram?'];
// ONE SEARCH BOX, FILTERS BESIDE IT (plan 3.5). Typing lists everything relevant as you type; the chips
// narrow by source, form, category and when. The Ask answer line stays: it counts what the search found.
// `said` is the date phrase read out of the typed words (when.js, 6.1): shown as a chip beside the tapped ones, removable like them.
const ASK = { src: null, form: null, cat: null, when: null, said: null };
const WHEN = window.DUMP_WHEN;
// the tapped "when" chip as a day range, so words and chips narrow through one comparison
function chipRange() {
  const t = new Date();
  if (ASK.when === 'week') return { from: WHEN.isoDay(WHEN.addDays(t, -7)), to: WHEN.isoDay(t), label: 'the last 7 days' };
  if (ASK.when === 'month') return WHEN.parse('this month', t);
  if (ASK.when === 'year') return WHEN.parse('this year', t);
  if (ASK.when === 'lastyear') return WHEN.parse('last year', t);
  return null;
}
function stripSaid() { if (!ASK.said) return; $('#askin').value = WHEN.without($('#askin').value, ASK.said); ASK.said = null; }
const CHIP_ROWS = [
  ['source', 'src', [['instagram', 'Instagram'], ['whatsapp', 'WhatsApp'], ['web', 'Web']]],
  ['form', 'form', [['reel', 'reels'], ['post', 'posts'], ['photo', 'photos'], ['video', 'videos'], ['voice', 'voice'], ['document', 'documents'], ['article', 'articles'], ['note', 'notes'], ['place', 'places'], ['product', 'products']]],
  ['when', 'when', [['week', 'this week'], ['month', 'this month'], ['year', 'this year'], ['lastyear', 'last year']]],
  ['category', 'cat', Object.keys(CATS).filter((c) => c !== 'unsorted').map((c) => [c, CATS[c].toLowerCase()])],
];
function renderChips() {
  const any = Object.values(ASK).some(Boolean);
  $('#askchips').innerHTML = CHIP_ROWS.map(([label, key, opts]) => `<span class="lbl">${label}</span>` + opts.map(([v, t]) => `<button type="button" class="chip${ASK[key] === v ? ' on' : ''}" data-chip="${key}" data-val="${esc(v)}">${esc(t)}</button>`).join('') + (key === 'when' && ASK.said ? `<button type="button" class="chip on said" data-chip="said" title="from your words">${esc(ASK.said.label)} ✕</button>` : '') + '<span class="sep"></span>').join('') + (any ? '<button type="button" class="chip" data-chip="clear">clear filters ✕</button>' : '');
}
let askTimer = null;
function openAsk(q) { $('#ask').classList.add('on'); $('#askin').value = q || ''; renderChips(); renderAsk(q || ''); setTimeout(() => $('#askin').focus(), 50); }
function closeAsk() { $('#ask').classList.remove('on'); }
function parseAsk(q) {
  // 6.1: the date words come out first, so "hotels last year" searches for hotels and narrows by the year
  const said = WHEN.parse(q); const s = WHEN.without(q, said).toLowerCase(); const facets = []; let cands = ITEMS.slice();
  const space = SPACES.find((sp) => s.includes(sp.name.toLowerCase())); if (space) { cands = cands.filter((i) => i.spaces.includes(space.id)); facets.push('in your Space ' + space.name); }
  const srcKey = Object.keys(SRCLABEL).find((k) => s.includes(k)); if (srcKey) { cands = cands.filter((i) => i.src === srcKey); facets.push('from ' + SRCLABEL[srcKey]); }
  const typeMap = { restaurant: ['place'], restaurants: ['place'], place: ['place'], places: ['place'], video: ['reel', 'video', 'tiktok'], videos: ['reel', 'video', 'tiktok'], reel: ['reel'], reels: ['reel'], document: ['doc', 'pdf'], documents: ['doc', 'pdf'], pdf: ['pdf'], pdfs: ['pdf'], photo: ['photo'], photos: ['photo'], voice: ['voice'], note: ['note'], notes: ['note'], article: ['article'], articles: ['article'], link: ['article', 'video', 'reel', 'post'], links: ['article', 'video', 'reel', 'post'] };
  const words = s.replace(/[?.,!"]/g, ' ').split(/\s+/).filter(Boolean);
  const tk = words.find((w) => typeMap[w]); if (tk) { cands = cands.filter((i) => typeMap[tk].includes(i.type)); facets.push(tk); }
  const catKey = Object.keys(CATS).find((c) => c !== 'unsorted' && s.includes(CATS[c].toLowerCase())); if (catKey && !tk) { cands = cands.filter((i) => i.cat === catKey); facets.push('in ' + CATS[catKey]); }
  // the words' date range and the tapped chip's, each a day range on captured_at; both narrow when both are there
  if (said) { cands = cands.filter((i) => WHEN.inRange(dayKey(i.date), said)); facets.push('from ' + said.label); }
  // THE CHIPS. What a person tapped narrows everything the words found; the words never override a chip.
  if (ASK.src) { cands = cands.filter((i) => i.src === ASK.src); facets.push('from ' + (SRCLABEL[ASK.src] ?? ASK.src)); }
  if (ASK.form === 'product') { cands = cands.filter(isProduct); facets.push('naming a product or a brand'); }
  else if (ASK.form) { cands = cands.filter((i) => (i.form ?? i.type) === ASK.form || i.type === ASK.form); facets.push(ASK.form + 's'); }
  if (ASK.cat) { cands = cands.filter((i) => i.cat === ASK.cat); facets.push('in ' + CATS[ASK.cat]); }
  const chipped = chipRange(); if (chipped) { cands = cands.filter((i) => WHEN.inRange(dayKey(i.date), chipped)); facets.push('from ' + chipped.label); }
  if (/unorganis|never organis|not in a space|no space|unfiled/.test(s)) { cands = cands.filter((i) => !i.spaces.length); facets.push('not in any Space'); }
  const stop = new Set(['what', 'did', 'i', 'save', 'saved', 'show', 'me', 'find', 'the', 'that', 'things', 'thing', 'about', 'have', 'of', 'for', 'from', 'my', 'a', 'an', 'in', 'on', 'to', 'all', 'everything', 'add', 'added', 'sent', 'send', 'last', 'week', 'month', 'year', 'this', 'past', 'not', 'any', 'space', 'is', 'are', 'was', 'were', 'those', 'these', 'some', 'stuff']);
  const rest = words.filter((w) => !stop.has(w) && !typeMap[w] && !(space && space.name.toLowerCase().includes(w)) && !(srcKey && w.includes(srcKey)) && !(catKey && CATS[catKey].toLowerCase().includes(w)));
  return { cands, facets, rest, said, empty: !facets.length && !rest.length && !ASK.src && !ASK.form && !ASK.cat && !ASK.when };
}
async function renderAsk(q) {
  const B = $('#askbody'); askSeq++;   // typing again drops any answer still on its way
  ASK.said = WHEN.parse(q); renderChips();
  if (!q.trim() && !Object.values(ASK).some(Boolean)) { B.innerHTML = `<p class="answer">Type a word, a #tag, a month, a year, or a question. Tekensa searches what you sent, what it read inside, and what you noted; the chips narrow it.</p><div class="tries">${TRIES.map((t) => `<button data-try="${esc(t)}">${esc(t)}</button>`).join('')}</div>`; return; }
  const { cands, facets, rest, empty } = parseAsk(q);
  let results = cands;
  if (rest.length) {
    // One search door: search_captures() (0012) — whole words and phrases first, then prefixes of the
    // same words, ranked on the server; RLS is the only wall. Any-of is the fallback when all-of is empty.
    const { data, error } = await sb.rpc('search_captures', { q: rest.join(' '), lim: 200 });
    if (error) { B.innerHTML = `<p class="err">${esc(error.message)}</p>`; return; }
    let rank = new Map((data ?? []).map((r, i) => [r.id, i]));
    if (!rank.size && rest.length > 1) { const { data: d2 } = await sb.rpc('search_captures', { q: rest.join(' or '), lim: 200 }); rank = new Map((d2 ?? []).map((r, i) => [r.id, i])); if (rank.size) facets.push('matching any of “' + rest.join(' ') + '”'); }
    else facets.push('matching “' + rest.join(' ') + '”');
    results = cands.filter((i) => rank.has(i.id)).sort((a, b) => rank.get(a.id) - rank.get(b.id));
  }
  if (empty) results = [];
  const limited = results.filter((i) => i.limited).length;
  const kinds = {}; results.forEach((i) => { kinds[i.type] = (kinds[i.type] ?? 0) + 1; });
  const desc = Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${n} ${k}${n > 1 ? 's' : ''}`).join(', ');
  const ans = !results.length ? `<p class="answer">Nothing about that yet. If you sent it, it'll be here; if not, send it and forget about it.</p>` : `<p class="answer">You saved <span class="n">${results.length}</span> thing${results.length > 1 ? 's' : ''} ${facets.join(', ')}${results.length > 1 ? `, including ${desc}` : ''}.</p>${limited ? `<p class="honest">${limited} of these are links Tekensa couldn't read inside; they matched on your words.</p>` : ''}`;
  B.innerHTML = `${ans}${results.length ? `<div class="askacts"><button class="y" data-ask-space>make a space from these</button></div>` : ''}<div class="grid">${results.map((i) => cardHtml(i, { grid: true })).join('')}</div>${installLine()}`;
  B._cands = results;
}
/* ---------- 6.7: a question goes to the server's ask; the cards are the ids it names, never the sentence ---------- */
let askSeq = 0;
// the tapped chips, in the function's own words. The form chips are display words; the function takes the schema's seven
// kinds, so each form is sent as the kind it belongs to (a reel is a link). "products" has no server filter and is not sent.
const KIND_OF_FORM = { photo: 'image', video: 'video', voice: 'audio', document: 'document', note: 'text', reel: 'link', post: 'link', article: 'link', place: 'link' };
function askFilters(said) {
  const f = {};
  if (ASK.src) f.sources = [ASK.src];
  if (ASK.form && KIND_OF_FORM[ASK.form]) f.kinds = [KIND_OF_FORM[ASK.form]];
  if (ASK.cat) f.categories = [ASK.cat];
  const range = WHEN.intersect(said, chipRange());
  if (range) { f.from = range.from; f.to = range.to; }
  return Object.keys(f).length ? f : undefined;
}
async function askServer(q) {
  const B = $('#askbody'); const seq = ++askSeq;
  ASK.said = WHEN.parse(q); renderChips();
  B.innerHTML = `<p class="status-pill"><i></i>asking</p><p class="answer" style="color:var(--mute)">${esc(q)}</p>`;
  let res, body = {};
  try {
    res = await fetch(cfg.askUrl, { method: 'POST', headers: { authorization: 'Bearer ' + session.access_token, apikey: cfg.supabaseAnonKey, 'content-type': 'application/json' }, body: JSON.stringify({ q, filters: askFilters(ASK.said) }) });
    body = await res.json().catch(() => ({}));
  } catch (e) { if (seq !== askSeq) return; B.innerHTML = `<p class="err">Could not ask right now: ${esc(e.message)}. The search box still works.</p>`; B._cands = []; return; }
  if (seq !== askSeq) return;
  if (res.status === 429) { B.innerHTML = `<p class="answer">That is your hundred questions for today; the search box still works.</p>`; B._cands = []; return; }
  if (!res.ok) { B.innerHTML = `<p class="err">Could not ask right now (${res.status}${body && body.error ? ': ' + esc(String(body.error)) : ''}). The search box still works.</p>`; B._cands = []; return; }
  const byId = new Map(ITEMS.map((i) => [i.id, i]));
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
  const results = ids.map((id) => byId.get(id)).filter(Boolean);
  const older = ids.length - results.length;   // named by the server but past the 500 this page holds
  const count = Number.isFinite(Number(body.count)) ? Number(body.count) : ids.length;
  const limited = Number(body.limited) || 0;
  const took = Number(body.took_ms) > 0 ? ` · ${(Number(body.took_ms) / 1000).toFixed(1)} s` : '';
  B.innerHTML = `<p class="answer">${esc(body.answer || 'Nothing about that yet.')}</p>
    <p class="askcount"><span class="n">${count}</span> thing${count === 1 ? '' : 's'}${limited ? ` · ${limited} ${limited === 1 ? 'is a link' : 'are links'} Tekensa couldn't read inside` : ''}${older ? ` · ${older} older ${older === 1 ? 'one is' : 'are'} not on this page` : ''}${took}</p>
    ${body.honest ? `<p class="honest">${esc(body.honest)}</p>` : ''}
    ${results.length ? `<div class="askacts"><button class="y" data-ask-space>make a space from these</button></div>` : ''}${installLine()}
    <div class="grid">${results.map((i) => cardHtml(i, { grid: true })).join('')}</div>`;
  B._cands = results;
}

/* ---------- add ---------- */
function openUpload() { $('#upload').classList.add('on'); $('#upload').innerHTML = `<div class="upbox"><h3>add something</h3><input id="up-text" placeholder="Paste a link, or type anything you don't want to lose…"><input id="up-caption" placeholder="A word or two (optional)"><label class="drop" style="cursor:pointer">or choose a file<br><span style="font-size:12px">images · video · PDF · voice · text · up to 100 MB</span><input id="up-file" type="file" style="display:none"></label><p class="err" id="up-err"></p><div class="run"><button id="upx">cancel</button><button class="y" id="upgo">keep it</button></div></div>`; setTimeout(() => $('#up-text').focus(), 30); }
async function doUpload() {
  const text = $('#up-text').value.trim(), caption = $('#up-caption').value.trim(), file = $('#up-file').files[0];
  const errEl = $('#up-err'); errEl.textContent = '';
  if (!text && !file) { errEl.textContent = 'Paste something or choose a file.'; return; }
  if (!addKey) addKey = crypto.randomUUID();   // the same key on a retry of this attempt: one row, not two
  $('#upgo').disabled = true; $('#upgo').textContent = 'Keeping…';
  try {
    let res;
    if (file) { const fd = new FormData(); fd.append('file', file); if (caption) fd.append('caption', caption); res = await fetch(cfg.ingestUrl, { method: 'POST', headers: { authorization: 'Bearer ' + session.access_token, apikey: cfg.supabaseAnonKey, 'idempotency-key': addKey }, body: fd }); }
    else { const isUrl = /^https?:\/\/\S+$/i.test(text); res = await fetch(cfg.ingestUrl, { method: 'POST', headers: { authorization: 'Bearer ' + session.access_token, apikey: cfg.supabaseAnonKey, 'content-type': 'application/json', 'idempotency-key': addKey }, body: JSON.stringify(isUrl ? { url: text, caption: caption || null } : { text, caption: caption || null }) }); }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { errEl.textContent = body.error ?? ('Could not keep it (' + res.status + ')'); $('#upgo').disabled = false; $('#upgo').textContent = 'Keep it'; return; }
    addKey = null;
    $('#upload').classList.remove('on'); toast('Kept. Tekensa is understanding it.');
    await loadAll(); route(); pollUntilReady(body.id);
  } catch (e) { errEl.textContent = 'Network: ' + e.message; $('#upgo').disabled = false; $('#upgo').textContent = 'Keep it'; }
}
async function pollUntilReady(id, tries = 0) {
  if (tries > 40) return;
  const { data } = await sb.from('captures').select('status').eq('id', id).maybeSingle();
  if (data && ['ready', 'limited'].includes(data.status)) { await loadAll(); route(); toast(data.status === 'ready' ? 'Understood and filed.' : 'Kept; understanding was limited.'); return; }
  setTimeout(() => pollUntilReady(id, tries + 1), 4000);
}

document.addEventListener('click', async (e) => {
  const t = e.target;
  if (t.id === 'signout') { await sb.auth.signOut(); return; }
  if (t.id === 'erase-start') { $('#erase-confirm').hidden = false; $('#erase-words').value = ''; $('#erase-go').disabled = true; $('#erase-words').focus(); return; }
  if (t.id === 'erase-cancel') { $('#erase-confirm').hidden = true; return; }
  if (t.id === 'erase-go') {
    const words = $('#erase-words').value;
    if (words.trim().toUpperCase() !== 'DELETE EVERYTHING') { $('#erase-err').textContent = 'Type the words exactly.'; return; }
    t.disabled = true; t.textContent = 'Deleting…'; $('#erase-err').textContent = '';
    try {
      const res = await fetch(cfg.eraseUrl, { method: 'POST', headers: { authorization: 'Bearer ' + session.access_token, 'content-type': 'application/json' }, body: JSON.stringify({ confirm: words }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) { $('#erase-err').textContent = 'Not finished: stopped at ' + (out.stage ?? 'unknown') + (out.error ? ' (' + out.error + ')' : '') + '. Nothing you did not ask for was deleted; try again.'; t.disabled = false; t.textContent = 'Delete everything'; return; }
      toast('Deleted: ' + out.captures + ' things, ' + out.objects + ' files, your sign-in.');
      await sb.auth.signOut();
    } catch (e) { $('#erase-err').textContent = String(e.message || e); t.disabled = false; t.textContent = 'delete everything'; }
    return;
  }
});

document.addEventListener('input', (e) => { if (e.target.id === 'erase-words') $('#erase-go').disabled = e.target.value.trim().toUpperCase() !== 'DELETE EVERYTHING'; });

/* ---------- router + events ---------- */
function setNav(k) { document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === k)); }
function show(id) { document.querySelectorAll('.view').forEach((v) => v.classList.remove('on')); $('#' + id).classList.add('on'); window.scrollTo({ top: 0 }); }
function route() {
  if (!session) { location.replace('/login/'); return; }
  const p = (location.hash || '#/home').slice(2).split('/');
  if (p[0] === 'home' || p[0] === '') { renderHome(); show('v-home'); setNav('home'); }
  else if (p[0] === 'c' || p[0] === 'src' || p[0] === 'all' || p[0] === 'shelf' || p[0] === 'products' || p[0] === 'entity') { renderList(p[0], p[1]); show('v-list'); setNav('home'); }
  else if (p[0] === 'days') { renderDays(); show('v-days'); setNav('days'); }
  else if (p[0] === 'lists') { renderLists(); show('v-lists'); setNav('lists'); }
  else if (p[0] === 'spaces') { renderSpaces(); show('v-spaces'); setNav('spaces'); }
  else if (p[0] === 's') { renderSpace(p[1]); show('v-space'); setNav('spaces'); }
  else if (p[0] === 'you') { $('#you-email').textContent = session.user.email ?? ''; show('v-you'); setNav('you'); renderAudit(); renderChannels(); }
  else if (p[0] === 'item') { renderHome(); show('v-home'); openItem(p[1]); }
  else location.hash = '#/home';
}
window.addEventListener('hashchange', route);
document.addEventListener('click', async (e) => {
  const t = e.target;
  const card = t.closest('.card'); if (card) { openItem(card.dataset.id); return; }
  if (t.id === 'sheetx' || t.id === 'scrim') { closeSheet(); return; }
  if (t.id === 'newspace') { await newSpace(); renderSpaces(); return; }
  if (t.closest('[data-newspace]') && openId) { await newSpace(openId); openItem(openId); return; }
  const tog = t.closest('[data-tog]'); if (tog && openId) { const i = ITEMS.find((x) => x.id === openId); if (i.spaces.includes(tog.dataset.tog)) await removeFromSpace(openId, tog.dataset.tog); else await addToSpace(openId, tog.dataset.tog); openItem(openId); return; }
  if (t.closest('[data-del]')) { $('#del-confirm').hidden = false; return; }
  if (t.closest('[data-del-no]')) { $('#del-confirm').hidden = true; return; }
  const dg = t.closest('[data-del-go]');
  if (dg) {
    // T11: one thing, soft-deleted now (hidden at once), undoable for a day; bytes and rows go with the nightly job after the grace
    const id = dg.dataset.delGo;
    const { data: ok, error } = await sb.rpc('set_capture_deleted', { p_id: id, p_deleted: true });
    if (error || !ok) return toast(error ? error.message : 'Not yours to delete');
    $('#sheet').innerHTML = ''; openId = null; await loadAll(); route();
    const tt = $('#toast'); tt.innerHTML = 'Deleted. <button class="btn" data-undel="' + id + '" style="margin-left:8px">undo</button>'; tt.classList.add('on'); clearTimeout(tt._t); tt._t = setTimeout(() => tt.classList.remove('on'), 8000);
    return;
  }
  const ud = t.closest('[data-undel]');
  if (ud) { const { error } = await sb.rpc('set_capture_deleted', { p_id: ud.dataset.undel, p_deleted: false }); if (error) return toast(error.message); await loadAll(); route(); toast('Kept after all'); return; }
    const rr = t.closest('[data-reread]');
  if (rr) {
    // T03: the owner asks for one capture to be read again; the server refuses anything not theirs or already in flight
    const id = rr.dataset.reread; rr.disabled = true; rr.textContent = 'Reading…';
    const { data: ok, error } = await sb.rpc('reprocess_capture', { p_id: id });
    if (error || !ok) { toast(error ? error.message : 'Not now: it is already being read'); rr.disabled = false; rr.textContent = 'read again'; return; }
    for (let n = 0; n < 24; n++) { await new Promise((r) => setTimeout(r, 5000)); const { data: row } = await sb.from('captures').select('status').eq('id', id).maybeSingle(); if (row && ['ready', 'limited', 'failed'].includes(row.status)) break; }
    await loadAll(); route(); openItem(id); toast('Read again');
    return;
  }
    const sc = t.closest('[data-setcat]'); if (sc && openId) { const i = ITEMS.find((x) => x.id === openId); await correct(i, 'category', sc.dataset.setcat); openItem(openId); route(); toast('Filed under ' + CATS[sc.dataset.setcat] + '. Tekensa won’t change it back.'); return; }
  const rx = t.closest('[data-rmtag]'); if (rx && openId) { const i = ITEMS.find((x) => x.id === openId); await correct(i, 'tags', i.tags.filter((x) => x !== rx.dataset.rmtag)); openItem(openId); return; }
  if (t.id === 'addtag-go' && openId) { const v = $('#addtag-in').value.trim(); if (!v) return; const i = ITEMS.find((x) => x.id === openId); await correct(i, 'tags', [...new Set([...i.tags, v.toLowerCase()])]); openItem(openId); return; }
  const tr = t.closest('[data-try]'); if (tr) { $('#askin').value = tr.dataset.try; askServer(tr.dataset.try); return; }
  if (t.closest('[data-install-x]')) { try { localStorage.setItem(INSTALL_KEY, '1'); } catch {} document.querySelectorAll('.install-line').forEach((el) => el.remove()); return; }
  if (t.closest('[data-ent]')) { closeSheet(); return; }   // the link itself moves to the entity shelf
  if (t.closest('[data-ask-space]')) { const c = $('#askbody')._cands ?? []; const id = await newSpace(); if (!id) return; for (const i of c) await addToSpace(i.id, id); closeAsk(); location.hash = '#/s/' + id; return; }
  const lay = t.closest('[data-layout]'); if (lay) { layout = lay.dataset.layout; document.querySelectorAll('[data-layout]').forEach((b) => b.classList.toggle('on', b === lay)); renderHome(); return; }
  if (t.id === 'addbtn') { openUpload(); return; }
  if (t.id === 'upx' || t.id === 'upload') { $('#upload').classList.remove('on'); return; }
  if (t.id === 'upgo') { doUpload(); return; }
});
$('#askfield').addEventListener('click', () => openAsk('')); $('#askm').addEventListener('click', () => openAsk('')); $('#askx').addEventListener('click', closeAsk);
$('#askin').addEventListener('input', () => { clearTimeout(askTimer); askTimer = setTimeout(() => renderAsk($('#askin').value), 250); });
$('#askchips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-chip]'); if (!b) return;
  if (b.dataset.chip === 'clear') { stripSaid(); for (const k of Object.keys(ASK)) ASK[k] = null; }
  else if (b.dataset.chip === 'said') stripSaid();   // the words come out of the box, so the chip does not come straight back
  else { const k = b.dataset.chip; ASK[k] = ASK[k] === b.dataset.val ? null : b.dataset.val; }
  renderChips(); renderAsk($('#askin').value);
});
$('#ask').addEventListener('click', (e) => { if (e.target.id === 'ask') closeAsk(); });
// typing searches as it goes; the ask button (or Enter) puts the words to the server as a question
$('#askform').addEventListener('submit', (e) => { e.preventDefault(); clearTimeout(askTimer); const q = $('#askin').value.trim(); if (q) askServer(q); else renderAsk(''); });
document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openAsk(''); } if (e.key === 'Escape') { closeAsk(); closeSheet(); $('#upload').classList.remove('on'); } });
$('#sheet').addEventListener('change', async (e) => { const n = e.target.closest('[data-note]'); if (!n) return; const i = ITEMS.find((x) => x.id === n.dataset.note); const { error } = await sb.from('captures').update({ note: n.value }).eq('id', i.id); if (error) return toast(error.message); i.note = n.value; toast('Note saved'); });
/* drag and drop */
let dragId = null;
document.addEventListener('dragstart', (e) => { const c = e.target.closest('.card'); if (!c) return; dragId = c.dataset.id; c.classList.add('dragging'); $('#dock').innerHTML = `<span class="lbl">Drop into</span>` + SPACES.map((s) => `<div class="d" data-drop="${s.id}">${esc(s.name)}</div>`).join('') + `<div class="d" data-drop="__new">+ New Space</div>`; $('#dock').classList.add('on'); });
document.addEventListener('dragend', () => { document.querySelectorAll('.card.dragging').forEach((c) => c.classList.remove('dragging')); $('#dock').classList.remove('on'); document.querySelectorAll('.over').forEach((x) => x.classList.remove('over')); });
document.addEventListener('dragover', (e) => { const d = e.target.closest('[data-drop],[data-space]'); if (d) { e.preventDefault(); d.classList.add('over'); } });
document.addEventListener('dragleave', (e) => { const d = e.target.closest('[data-drop],[data-space]'); if (d) d.classList.remove('over'); });
document.addEventListener('drop', async (e) => { const d = e.target.closest('[data-drop],[data-space]'); if (!d || !dragId) return; e.preventDefault(); const sid = d.dataset.drop || d.dataset.space; if (sid === '__new') await newSpace(dragId); else await addToSpace(dragId, sid); $('#dock').classList.remove('on'); dragId = null; });

/* ---------- boot ---------- */
// /login is the one way in. INITIAL_SESSION is handled by getSession below (one load, not two); SIGNED_IN fires again
// on tab refocus and TOKEN_REFRESHED hourly, neither of which is a reason to rebuild the view (review, 2026-09-25)
sb.auth.onAuthStateChange((evt, s) => {
  if (evt === 'SIGNED_OUT') { session = null; location.replace('/login/'); return; }
  if (s) session = s;
});
sb.auth.getSession().then(async ({ data }) => { session = data.session; if (!session) { location.replace('/login/'); return; } $('#avatar').textContent = (session.user.email ?? '·')[0].toUpperCase(); await loadAll(); route(); });

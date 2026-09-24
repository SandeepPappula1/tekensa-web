/* moved out of the page on 2026-09-25 so the Content-Security-Policy can refuse inline scripts: a script injected into the page cannot run. */
(() => {
  const cfg = window.DUMP_CONFIG;
  const T = window.DUMP_TYPES;
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  const $ = (s) => document.querySelector(s);

  /** How many rows a collection draws. index.html reads 500 for everything; one
   *  kind is a slice of that, and the line below SAYS when it is a slice —
   *  a silent truncation is the one thing a collection must not do. */
  const PAGE = 200;

  const params = new URLSearchParams(location.search);
  const kind = T.KINDS.includes(params.get('kind')) ? params.get('kind') : 'link';

  document.title = `${T.KIND_LABEL[kind]} · Tekensa`;
  $('#col-title').textContent = T.KIND_LABEL[kind];

  // The switcher. Every kind the schema allows gets a chip, so nothing a person
  // has sent is unreachable from here.
  $('#col-kinds').innerHTML = T.KINDS.map((k) => {
    const here = k === kind;
    return `<a class="btn col-kind" href="?kind=${encodeURIComponent(k)}"${here ? ' aria-current="page"' : ''}>${T.KIND_LABEL[k]}</a>`;
  }).join('');

  /* a link is followed only if it is http(s): a javascript: or data: URL kept as an item must never become a clickable href (security audit, 2026-09-25) */
const safeUrl = (u) => { try { const x = new URL(String(u ?? ''), location.href); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; } catch { return ''; } };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const when = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  };

  /** The bytes behind a card, if this type has any. Same rule and same bucket as
   *  index.html's `mediaUrl`; asking for a signed URL for an article would be
   *  asking for something that does not exist. */
  async function thumbFor(row, type) {
    const f = row.facets ?? {};
    if (f.link?.image) return f.link.image;
    if (!T.MEDIA_TYPES.includes(type)) return null;
    const { data } = await sb.from('capture_media').select('object_path').eq('capture_id', row.id).eq('role', 'original').maybeSingle();
    if (!data) return null;
    const { data: s } = await sb.storage.from('dump-media').createSignedUrl(data.object_path, 600);
    return s?.signedUrl ?? null;
  }

  /**
   * WHAT A CARD SAYS WHEN THE THING IS NOT READY.
   *
   * A capture that failed to be understood is still the person's, so it is
   * drawn, and the card says which of the two it is rather than looking like a
   * finished item. `limited` means we kept it and could not read it; `failed`
   * means the run itself broke. The bytes are there either way.
   */
  function stateNote(row) {
    if (row.status === 'ready') return '';
    if (row.status === 'limited') return 'kept, not read';
    if (row.status === 'failed') return 'kept, something went wrong';
    return 'still working on it';
  }

  function card(row, type, thumb) {
    const title = row.title || (row.original_text ? row.original_text.slice(0, 80) : '') || 'Kept';
    const note = stateNote(row);
    const src = T.SRC_LABEL[row.platform] ?? T.SRC_LABEL[row.channel] ?? row.channel;
    const art = thumb
      ? `<img class="col-thumb" src="${esc(safeUrl(thumb))}" alt="" loading="lazy" />`
      : `<div class="col-thumb-none">${esc(type)}</div>`;
    const open = row.original_url
      ? `<a href="${esc(safeUrl(row.original_url))}" target="_blank" rel="noopener noreferrer">open</a>`
      : '';
    return `<article class="col-card">
      ${art}
      <div class="col-body">
        <div class="col-title">${esc(title)}</div>
        <div class="col-meta">
          <span class="col-badge">${esc(type)}</span>
          <span>${esc(src)}</span>
          <span>${esc(when(row.captured_at))}</span>
          ${note ? `<span>${esc(note)}</span>` : ''}
          ${open}
        </div>
      </div>
    </article>`;
  }

  async function load() {
    const { data: sess } = await sb.auth.getSession();
    if (!sess?.session) {
      $('#col-loading').hidden = true;
      $('#col-signin').hidden = false;
      return;
    }

    // Owner isolation is the server's job (RLS on `captures`), not a filter
    // written here. This query names no user id at all.
    const { data, error } = await sb
      .from('captures')
      .select('id, kind, channel, platform, status, understanding, original_text, original_url, caption, captured_at, title, summary, tags, facets')
      .eq('kind', kind)
      .is('deleted_at', null)
      .order('captured_at', { ascending: false })
      .limit(PAGE + 1);

    $('#col-loading').hidden = true;

    if (error) {
      $('#col-err').textContent = 'Could not load your things just now. Try again in a moment.';
      return;
    }

    const rows = data ?? [];
    const more = rows.length > PAGE;
    const shown = more ? rows.slice(0, PAGE) : rows;

    if (shown.length === 0) {
      // AN HONEST EMPTY STATE. It says what is missing and does not imply the
      // feature is broken or that things were lost.
      $('#col-empty').textContent = `Nothing here yet. When you send ${T.KIND_LABEL[kind].toLowerCase()} to Tekensa, they will show up here.`;
      $('#col-empty').hidden = false;
      $('#col-count').textContent = '';
      return;
    }

    $('#col-count').textContent = shown.length === 1 ? '1 thing' : `${shown.length} things`;

    const cards = await Promise.all(
      shown.map(async (row) => {
        const type = T.typeOf(row);
        const thumb = await thumbFor(row, type).catch(() => null);
        return card(row, type, thumb);
      })
    );
    $('#col-grid').innerHTML = cards.join('');
    $('#col-grid').hidden = false;

    if (more) {
      // SAY THE BOUND. A collection that quietly stopped at 200 would be telling
      // a person they have fewer things than they do.
      $('#col-more').textContent = `Showing the ${PAGE} most recent. There are older ones — open Tekensa to search for them.`;
      $('#col-more').hidden = false;
    }
  }

  sb.auth.onAuthStateChange(() => { void load(); });
  void load();
})();

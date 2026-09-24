/**
 * What a capture LOOKS LIKE, in one place.
 *
 * `kind` is the schema's word for what arrived (migration 0007's
 * `check (kind in ...)`, seven values). `type` is the finer display word the
 * pages use — a link to a Reel and a link to a recipe are both `kind = 'link'`
 * and should not look the same on a shelf.
 *
 * THIS FILE EXISTS SO THERE IS ONE DERIVATION AND NOT TWO. The mapping was
 * inline in `index.html`; `collection.html` needs the identical answer, and a
 * second copy of a rule is the defect this repository keeps paying for. Lifted
 * verbatim in behaviour — if a shelf and a collection ever disagree about what
 * a thing is, it is a bug in here and nowhere else.
 *
 * No imports, no build step: a plain script tag, the same as `config.js`.
 */
(() => {
  /** The seven `kind` values the schema allows, in the order a person meets them. */
  const KINDS = ['link', 'image', 'video', 'audio', 'document', 'text', 'unknown'];

  /** What each collection is called. `unknown` is named honestly rather than
   *  hidden: a thing we could not read is still the person's, and a page that
   *  quietly omitted it would be the silent-drop class. */
  const KIND_LABEL = {
    link: 'Links',
    image: 'Photos',
    video: 'Videos',
    audio: 'Voice',
    document: 'Documents',
    text: 'Notes',
    unknown: 'Everything else',
  };

  /** The display word, derived exactly as index.html derived it. */
  function typeOf(r) {
    const p = r.platform;
    const f = r.facets ?? {};
    if (r.kind === 'image') return 'photo';
    if (r.kind === 'video') return 'video';
    if (r.kind === 'audio') return 'voice';
    if (r.kind === 'document') {
      return f.upload?.mime === 'application/pdf' || /\.pdf$/i.test(f.upload?.name ?? '') ? 'pdf' : 'doc';
    }
    if (r.kind === 'link') {
      if (p === 'instagram') return f.link?.label === 'reel' ? 'reel' : 'post';
      if (p === 'youtube' || p === 'vimeo') return 'video';
      if (p === 'tiktok') return 'tiktok';
      if (p === 'reddit') return 'reddit';
      if (['spotify', 'apple music', 'soundcloud'].includes(p)) return 'music';
      if (f.link?.label === 'product') return 'product';
      if (f.link?.label === 'place') return 'place';
      return 'article';
    }
    return 'note';
  }

  /** Which types can have bytes of their own behind them. `index.html`'s
   *  `mediaUrl` uses the same set; a page asking for a signed URL for an
   *  article would be asking for something that does not exist. */
  const MEDIA_TYPES = ['photo', 'video', 'voice', 'pdf', 'doc'];

  const SRC_LABEL = {
    whatsapp: 'WhatsApp',
    instagram: 'Instagram',
    web: 'Web',
    app: 'App',
    youtube: 'YouTube',
    tiktok: 'TikTok',
    reddit: 'Reddit',
    spotify: 'Spotify',
  };

  window.DUMP_TYPES = { KINDS, KIND_LABEL, typeOf, MEDIA_TYPES, SRC_LABEL };
})();

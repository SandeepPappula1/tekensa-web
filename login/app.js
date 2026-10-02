/* moved out of the page on 2026-09-25 so the Content-Security-Policy can refuse inline scripts: a script injected into the page cannot run. */
(() => {
  const cfg = window.DUMP_CONFIG;
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  const $ = (s) => document.querySelector(s);

  const show = (id) => {
    for (const s of ['step-door', 'step-signin', 'step-code', 'step-done']) $('#' + s).hidden = s !== id;
  };

  /**
   * WHAT THE PERSON IS TOLD WHEN IT DOES NOT WORK.
   *
   * The server answers `invalid_or_expired` for a code that is wrong, one that
   * has expired, and one already used — deliberately, because telling them
   * apart tells a guesser which codes exist. The copy here matches that: one
   * sentence covering all three, and a way forward.
   */
  const REASONS = {
    invalid_or_expired: 'That code did not work. It may have expired, or already been used. Send us another message on WhatsApp or Instagram and we will send a new one.',
    too_many_attempts: 'Too many tries. Wait an hour and try again, or send us another message for a fresh code.',
    cannot_link: 'We could not link that. It may already belong to a different Tekensa account.',
  };

  let email = '';

  // THE CODE MAY ARRIVE IN THE LINK. The DM reply says `tekensa.com/login?c=123456`, so
  // a person who taps it should not have to type the code again. It is read
  // once, shown in the field, and consumed only after sign-in — a code is
  // never sent to the server by a page that has no session. Only six digits
  // are ever taken from the URL; anything else is ignored.
  const fromUrl = (new URLSearchParams(location.search).get('c') || '').replace(/\D/g, '').slice(0, 6);
  if (fromUrl.length === 6) $('#lk-code').value = fromUrl;
  // tekensa.com/login is the one way in (2026-09-25). Arriving from a DM reply (`?c=` present) it links
  // what was sent; arriving plainly it is a sign-in, and a signed-in person goes straight to /home.
  const linking = new URLSearchParams(location.search).has('c');
  if (linking) $('#lk-title').textContent = 'link what you have sent';
  // Arriving from the DM: the Instagram code is shown as already in hand, the three steps are listed, and the
  // sign-in copy says plainly that the email code is a second, different code. Nothing here asks for the DM code.
  if (fromUrl.length === 6) {
    $('#have-code-value').textContent = fromUrl;
    $('#have-code').hidden = false;
    $('#steps').hidden = false;
    $('#si-lead').innerHTML = '<b>One more step: which email is your Tekensa account?</b>';
    $('#si-body').textContent = 'Sign in with your password if you have set one. Otherwise we email a sign-in link. New to Tekensa? The email link creates your account.';
    $('#si-verify').textContent = 'sign in and link';
  } else if (linking) {
    $('#lk-lead').textContent = 'Now the six-digit code from the Tekensa reply in your Instagram or WhatsApp.';
  }
  // A LINK THAT DID NOT WORK says so. Supabase sends a spent or expired link back here with
  // #error_description=… in the address; silently showing the sign-in form again reads as "it asked for
  // my email again" (founder, 25 Sep 2026). The words are shown once and the address is cleaned.
  const hashErr = new URLSearchParams(location.hash.replace(/^#/, '')).get('error_description');
  if (hashErr) {
    $('#si-err').textContent = 'That sign-in link did not work (' + hashErr.replace(/\+/g, ' ') + '). A link works once and for an hour. Enter your email below for a new one.';
    history.replaceState(null, '', location.pathname + location.search);
  }
  const stepNow = (n) => { for (const i of [1, 2, 3]) $('#st-' + i).classList.toggle('now', i === n); };
  let autoTried = false;

  /* ---------- the DM is the door (server 0029) ----------
     ?k=<43 characters> is a one-time key that came down the person's own Instagram or WhatsApp thread. The page asks
     the server what it is good for WITHOUT spending it (peek), then:
       - the inbox already has an account  → spend it, take the one-time sign-in token, and go to /home;
       - the inbox is new                  → ask one question. "open my tekensa" spends it and makes the account;
                                             "I already have an account" leaves it unspent and shows the ordinary
                                             sign-in, where the six-digit code in the same link joins the inbox.
     Only the key is ever sent. A key that is wrong, used or expired gets one plain sentence and the ordinary sign-in.
     The key is taken out of the address at once, so it is not left in the history of Instagram's browser. */
  const doorKey = (() => { const k = new URLSearchParams(location.search).get('k') || ''; return /^[A-Za-z0-9_-]{43}$/.test(k) && cfg.doorUrl ? k : ''; })();
  let doorActive = doorKey !== '';
  if (doorKey) history.replaceState(null, '', location.pathname + (fromUrl.length === 6 ? '?c=' + fromUrl : ''));
  const door = async (body) => {
    const res = await fetch(cfg.doorUrl, { method: 'POST', headers: { apikey: cfg.supabaseAnonKey, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    let json = {}; try { json = await res.json(); } catch {}
    return { ok: res.ok, status: res.status, json };
  };
  const doorFailed = (line) => { doorActive = false; $('#si-err').textContent = line; void refreshStep(); };
  const DOOR_GONE = 'That link has already been used or has expired. Send us anything on Instagram and the reply brings a fresh one — or sign in below.';
  async function openDoor() {
    $('#door-new').hidden = true; $('#door-err').textContent = '';
    $('#door-lead').innerHTML = '<b>Opening your Tekensa…</b>';
    let r; try { r = await door({ k: doorKey }); } catch { r = { ok: false, status: 0, json: {} }; }
    if (!r.ok) { doorFailed(r.status === 404 ? DOOR_GONE : r.status === 409 ? 'This inbox belongs to an account that signs in another way. Sign in below.' : 'Could not open it just now. Try the link again in a moment, or sign in below.'); return; }
    // the token the server made is good once and only here; `type` is the server's own word for it
    let v = await sb.auth.verifyOtp({ token_hash: r.json.token_hash, type: r.json.type || 'magiclink' });
    if (v.error && (r.json.type || 'magiclink') !== 'email') v = await sb.auth.verifyOtp({ token_hash: r.json.token_hash, type: 'email' });
    if (v.error) { doorFailed('Could not open it just now (' + v.error.message + '). Send us anything for a fresh link, or sign in below.'); return; }
    location.replace('/home/');
  }
  async function startDoor() {
    show('step-door');
    const { data } = await sb.auth.getSession();
    // already signed in in this browser: the key is not needed, and is left unspent
    if (data?.session) { location.replace('/home/'); return; }
    let p; try { p = await door({ k: doorKey, peek: true }); } catch { p = { ok: false, status: 0, json: {} }; }
    if (!p.ok) { doorFailed(p.status === 404 ? DOOR_GONE : 'Could not open it just now. Try the link again in a moment, or sign in below.'); return; }
    if (p.json.linked) { await openDoor(); return; }
    const who = (p.json.channel === 'instagram' ? 'Instagram' : p.json.channel === 'whatsapp' ? 'WhatsApp' : 'your inbox') + (p.json.name ? ' ' + String(p.json.name).replace(/^@?/, '@') : '');
    $('#door-lead').textContent = '';
    const b = document.createElement('b'); b.textContent = 'Saved from ' + who + '.'; $('#door-lead').appendChild(b);
    if (p.json.channel === 'whatsapp') $('#door-new .link-note').textContent = 'No email and no password. Your WhatsApp is the key: any time you send us something, the reply opens your Tekensa.';
    $('#door-new').hidden = false;
  }
  $('#door-open').addEventListener('click', () => { void openDoor(); });
  // "I already have an account": the key stays unspent; the ordinary sign-in below joins this inbox by the code in the link
  $('#door-have').addEventListener('click', () => { doorActive = false; void refreshStep(); });

  async function refreshStep() {
    if (doorActive) return;   // the door is deciding; it calls back here if it hands over to the ordinary sign-in
    const { data } = await sb.auth.getSession();
    if (data?.session && !linking) { location.replace('/home/'); return; }
    show(data?.session ? 'step-code' : 'step-signin');
    if (data?.session) {
      $('#lk-code').focus();
      // Signed in with a code already in the field: one automatic try, never a loop.
      if ($('#lk-code').value.length === 6 && !autoTried) { autoTried = true; $('#lk-submit').click(); }
    }
  }

  // GOOGLE. The same account as the email one (Supabase joins a Google identity to an existing account with the
  // same verified address), reached without an email being sent. It comes back to THIS page with the Instagram
  // code still in the address, exactly as the email link does, so the session it creates links at once. The
  // button is drawn only when config.js says the provider is on: with it off, Supabase answers a bare error page.
  if (cfg.googleSignIn === true) {
    $('#si-google-row').hidden = false;
    $('#si-google').addEventListener('click', async () => {
      $('#si-err').textContent = '';
      const back = location.origin + '/login/' + (fromUrl.length === 6 ? '?c=' + fromUrl : '');
      const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: back } });
      if (error) $('#si-err').textContent = 'Could not reach Google just now (' + error.message + '). Use your email below instead.';
    });
  }

  $('#si-send').addEventListener('click', async () => {
    $('#si-err').textContent = '';
    email = $('#si-email').value.trim();
    if (!email) return;
    // THE LINK COMES BACK HERE. The email Supabase sends carries a link (a code too, once the project has its
    // own mail template); the link must land on THIS page with the Instagram code still in the address, so the
    // session it creates is used at once to link. Without this, the link fell on the project's default site
    // URL (localhost, 25 Sep 2026) and the person saw "refused to connect".
    const back = location.origin + '/login/' + (fromUrl.length === 6 ? '?c=' + fromUrl : '');
    const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: back } });
    if (error) { $('#si-err').textContent = error.message; return; }
    $('#si-where').textContent = email;
    const safe = email.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    $('#si-sent').innerHTML = 'We emailed <b>' + safe + '</b>. <b>Tap the link in that email</b>: it brings you back here, signed in' + (fromUrl.length === 6 ? ', and links your Instagram' : '') + '. If the email shows a six-digit code instead, type it below.';
    $('#signin-email-row').hidden = true;
    $('#signin-code-row').hidden = false;
    stepNow(2);
  });

  // Sign in with a password: no email, no code. A wrong password is said plainly; the email link stays beside it.
  $('#si-pass-go').addEventListener('click', async () => {
    $('#si-err').textContent = '';
    email = $('#si-email').value.trim();
    const password = $('#si-pass').value;
    if (!email) { $('#si-err').textContent = 'Your email first.'; return; }
    if (!password) { $('#si-err').textContent = 'No password yet? Use "email me a sign-in link", then set one.'; return; }
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) { $('#si-err').textContent = /invalid login credentials/i.test(error.message) ? 'That email and password do not match. Forgot it? Use the email link and set a new one.' : error.message; return; }
    await refreshStep();
  });

  // Set a password on the linked screen, while the session from the email link is fresh.
  $('#set-pass-go').addEventListener('click', async () => {
    const msg = $('#set-pass-msg'); msg.textContent = '';
    const password = $('#set-pass').value;
    if (password.length < 8) { msg.textContent = 'Eight characters or more.'; return; }
    const { error } = await sb.auth.updateUser({ password });
    if (error) { msg.textContent = error.message; return; }
    $('#set-pass').value = '';
    msg.textContent = 'Saved. Next time, sign in with your email and this password.';
  });

  $('#si-verify').addEventListener('click', async () => {
    $('#si-err').textContent = '';
    const token = $('#si-code').value.trim();
    // the Instagram code typed where the email code goes: say which is which instead of "invalid"
    if (fromUrl.length === 6 && token === fromUrl) { $('#si-err').textContent = 'That is your Instagram code, and it is already in hand. Open the email we sent and tap its link, or type the code from the email if it shows one.'; return; }
    if (!/^\d{6,8}$/.test(token)) { $('#si-err').textContent = 'The sign-in code is the six digits in the email. No code in the email? Tap its link instead.'; return; }
    const { error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
    if (error) { $('#si-err').textContent = error.message; return; }
    await refreshStep();
  });

  $('#lk-submit').addEventListener('click', async () => {
    $('#lk-err').textContent = '';
    const code = $('#lk-code').value.trim();
    if (!/^\d{6}$/.test(code)) { $('#lk-err').textContent = 'Six digits, please.'; return; }

    // The ONLY thing sent is the code. No phone number, no identity id, no user
    // id: the account is read from the session token inside the database
    // function, so there is no field here that could name somebody else.
    const { data, error } = await sb.rpc('consume_link_code', { p_code: code });
    if (error) { $('#lk-err').textContent = 'Something went wrong. Try again in a moment.'; return; }

    if (!data || data.ok !== true) {
      $('#lk-err').textContent = REASONS[data && data.reason] || REASONS.invalid_or_expired;
      return;
    }

    // NUMBERS, NOT ADJECTIVES. A person who sent eleven things should be told
    // eleven, and a person whose account was already linked should be told that
    // rather than shown a celebration for work that did not happen.
    const moved = Number(data.moved || 0);
    // NAME THE ACCOUNT. The identity is now the person's own row, so its channel and display name
    // (the Instagram @username, the WhatsApp profile name) can be read back under RLS and said out
    // loud: a person who linked the wrong inbox should see that here, not discover it later.
    let who = 'This account';
    if (data.identity) {
      const { data: ident } = await sb.from('channel_identities').select('channel, display_name').eq('id', data.identity).maybeSingle();
      if (ident) who = (ident.channel === 'instagram' ? 'Instagram' : ident.channel === 'whatsapp' ? 'WhatsApp' : ident.channel) + (ident.display_name ? ' ' + ident.display_name : '');
    }
    if (data.already) {
      $('#lk-done-title').textContent = 'already linked';
      $('#lk-done-body').textContent = `${who} was already linked to your Tekensa. Everything you have sent is in there.`;
    } else {
      $('#lk-done-title').textContent = 'linked';
      $('#lk-done-body').textContent = `${who} is now linked to this email. ` + (moved === 1
        ? 'One thing you sent is now in your Tekensa.'
        : `${moved} things you sent are now in your Tekensa.`);
    }
    // 3.6: the app, offered under the password block, counting what just came in
    $('#get-app-body').textContent = (moved > 0 ? `Your ${moved} thing${moved === 1 ? ' is' : 's are'} in.` : 'Your things are in.') + ' Get the app to be reminded the day a bill is due.';
    $('#get-app').hidden = false;
    show('step-done');
    stepNow(3);
    // THE RECEIPT. The inbox that was just linked is told so, in its own thread, naming this email
    // (masked) and where to undo it: the one message that always reaches the inbox's real owner.
    // Fire and forget: the link already happened; a failed receipt is recorded server-side, never shown.
    if (data.identity && !data.already && cfg.linkedNoticeUrl) {
      try {
        const { data: sess } = await sb.auth.getSession();
        if (sess?.session) fetch(cfg.linkedNoticeUrl, { method: 'POST', headers: { authorization: 'Bearer ' + sess.session.access_token, apikey: cfg.supabaseAnonKey, 'content-type': 'application/json' }, body: JSON.stringify({ identity: data.identity }) }).catch(() => {});
      } catch {}
    }
  });

  // A code pasted from the message should just work.
  $('#lk-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
  });

  // once linked the done step stays: SIGNED_IN fires again on tab refocus and TOKEN_REFRESHED hourly (review, 2026-09-25)
  sb.auth.onAuthStateChange(() => { if ($('#step-done').hidden) void refreshStep(); });
  if (doorActive) void startDoor(); else void refreshStep();
})();

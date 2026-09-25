/* moved out of the page on 2026-09-25 so the Content-Security-Policy can refuse inline scripts: a script injected into the page cannot run. */
(() => {
  const cfg = window.DUMP_CONFIG;
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  const $ = (s) => document.querySelector(s);

  const show = (id) => {
    for (const s of ['step-signin', 'step-code', 'step-done']) $('#' + s).hidden = s !== id;
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

  async function refreshStep() {
    const { data } = await sb.auth.getSession();
    if (data?.session && !linking) { location.replace('/home/'); return; }
    show(data?.session ? 'step-code' : 'step-signin');
    if (data?.session) {
      $('#lk-code').focus();
      // Signed in with a code already in the field: one automatic try, never a loop.
      if ($('#lk-code').value.length === 6 && !autoTried) { autoTried = true; $('#lk-submit').click(); }
    }
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
  void refreshStep();
})();

/* moved out of the page on 2026-09-25 so the Content-Security-Policy can refuse inline scripts. */
  // The token stays in the URL only for this fallback page — never rendered as text,
  // never sent to a third party, never logged to anything but same-origin storage.
  var params = new URLSearchParams(window.location.search);
  var token = params.get('t');

  // The store listing, when there is one (plan 7.3) — the same address home/config.js carries. Until then the
  // page says the app is coming and sends the person to the web, which is the whole thing today.
  var STORE_URL = (window.DUMP_CONFIG && window.DUMP_CONFIG.appStoreUrl) || '';
  var cta = document.getElementById('ctaLink');
  if (STORE_URL) { cta.href = STORE_URL; } else { cta.href = '/home/'; cta.textContent = 'open Tekensa on the web'; }

  // No token: not an invite but a plain visit, the way /login and /home send people here (3.6, 3.7).
  // The page then says what the app adds and keeps its one button.
  if (!token) {
    document.getElementById('headline').textContent = 'Tekensa on your phone';
    document.getElementById('subline').textContent = STORE_URL ? 'A reminder the day a bill is due, the camera, and the share sheet. Everything you send on the web is there too.' : 'The Android app is coming: a reminder the day a bill is due, the camera, and the share sheet. Until then the web is the whole thing — everything you send is there.';
    document.getElementById('fallback').textContent = STORE_URL ? 'Already have it? Open it from your home screen.' : '';
  }

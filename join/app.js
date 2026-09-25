/* moved out of the page on 2026-09-25 so the Content-Security-Policy can refuse inline scripts. */
  // The token stays in the URL only for this fallback page — never rendered as text,
  // never sent to a third party, never logged to anything but same-origin storage.
  var params = new URLSearchParams(window.location.search);
  var token = params.get('t');

  // TODO before go-live: point this at the real Play Store / App Store listing once published.
  var STORE_URL = 'https://tekensa.com/';
  var cta = document.getElementById('ctaLink');
  cta.href = STORE_URL;

  // No token: not an invite but a plain visit, the way /login and /home send people here (3.6, 3.7).
  // The page then says what the app adds and keeps its one button.
  if (!token) {
    document.getElementById('headline').textContent = 'Tekensa on your phone';
    document.getElementById('subline').textContent = 'A reminder the day a bill is due, the camera, and the share sheet. Everything you send on the web is there too.';
    document.getElementById('fallback').textContent = 'Already have it? Open it from your home screen.';
  }

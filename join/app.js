/* moved out of the page on 2026-09-25 so the Content-Security-Policy can refuse inline scripts. */
  // The token stays in the URL only for this fallback page — never rendered as text,
  // never sent to a third party, never logged to anything but same-origin storage.
  var params = new URLSearchParams(window.location.search);
  var token = params.get('t');

  // TODO before go-live: point this at the real Play Store / App Store listing once published.
  var STORE_URL = 'https://tekensa.com/';
  var cta = document.getElementById('ctaLink');
  cta.href = STORE_URL;

  if (!token) {
    document.getElementById('headline').textContent = "This invite link isn't valid";
    document.getElementById('subline').textContent = 'Ask whoever sent it to share it again.';
    cta.style.display = 'none';
  }

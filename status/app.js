/* /status — public. The anon key asks status_public() once a minute and the page says four things in words.
   supabase-js is NOT loaded on purpose: it would pick up a signed-in visitor's stored session and send their token.
   A plain fetch with the anon key carries no one. Counts only, no realtime. */
(() => {
  const cfg = window.DUMP_CONFIG;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function ago(ts) {
    const t = Date.parse(ts ?? ''); if (!Number.isFinite(t)) return null;
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' days ago';
  }
  const line = (ok, words) => `<li class="${ok ? 'up' : 'down'}"><i></i><span>${esc(words)}</span></li>`;

  function render(d) {
    const s = Array.isArray(d) ? d[0] ?? {} : d ?? {};
    const median = Number(s.median_seconds_dm_to_filed_24h);
    const hasMedian = s.median_seconds_dm_to_filed_24h !== null && s.median_seconds_dm_to_filed_24h !== undefined && Number.isFinite(median);
    const incident = ago(s.last_incident_at);
    $('#s-lines').innerHTML = [
      line(s.door_open === true, s.door_open === true ? 'the door is open' : 'the door is closed'),
      line(s.worker_running === true, s.worker_running === true ? 'the worker is running' : 'the worker is not running'),
      line(true, hasMedian ? `median ${Math.round(median)} s from DM to filed, last 24 h` : 'nothing filed from a DM in the last 24 h'),
      line(true, incident ? `last incident ${incident}` : 'no incident on record'),
    ].join('');
    const at = Date.parse(s.as_of ?? '');
    $('#s-asof').textContent = 'as of ' + new Date(Number.isFinite(at) ? at : Date.now()).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) + ' · refreshed every minute';
  }

  async function load() {
    try {
      const res = await fetch(cfg.supabaseUrl + '/rest/v1/rpc/status_public', {
        method: 'POST',
        headers: { apikey: cfg.supabaseAnonKey, authorization: 'Bearer ' + cfg.supabaseAnonKey, 'content-type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) throw new Error(String(res.status));
      render(await res.json());
    } catch {
      $('#s-asof').textContent = 'Could not reach Tekensa just now. Asking again in a minute.';
    }
  }

  void load();
  setInterval(() => { void load(); }, 60000);
})();

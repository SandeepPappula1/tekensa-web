# apps/web — the three tekensa.com hosting artifacts

Static site, no build step. Deploy this whole `apps/web/` folder as-is to Vercel, Cloudflare Pages,
or Netlify (any of the three free tiers work), pointed at `tekensa.com`.

| Path | Purpose |
|---|---|
| `/` | The real landing page — see "`index.html` — the real landing page" below. |
| `/join/` | The Android App Link / invite fallback page. Opens directly in the app if it's installed (once `assetlinks.json` verifies) — this page only renders for people who don't have it yet. |
| `/delete-account/` | The Play Store–required web path to request account deletion without the app installed. |
| `/.well-known/assetlinks.json` | Proves `com.sandeeppappula.tekensa` owns this domain, so Android will open the app instead of the browser for `tekensa.com/join?...` links. |

## Things only the founder can fill in before this goes live

1. **`.well-known/assetlinks.json`** — the `sha256_cert_fingerprints` value is a placeholder. Get
   the real one from the release signing key: `eas credentials` (Android → view the app signing
   certificate) or, if signing locally, `keytool -list -v -keystore <path> | grep SHA256`. Paste it
   in, replacing `REPLACE_WITH_RELEASE_SIGNING_SHA256_FINGERPRINT`.
2. **`/join/index.html`** — the `STORE_URL` constant currently points at the domain root. Once
   Tekensa has a real Play Store / App Store listing, point it there instead.

Two mailboxes need to exist and be read (forward to a personal inbox is fine):
- `privacy@tekensa.com` — account-deletion requests from the delete-account page.
- `hello@tekensa.com` — the landing page's "Notify me" waitlist sends here (it's a `mailto:` capture,
  zero backend: the visitor's own mail client opens pre-filled and they hit send). If a real
  waitlist backend (Formspree, Tally, a Supabase table) gets wired up later, swap the `<form>`
  handler in `index.html`'s inline `<script>` for a `fetch()` POST instead.

## `index.html` — the real landing page

Single self-contained file, no build step, same token system as `/join/` and `/delete-account/`
(`--ink`/`--paper`/`--card`/`--accent`/`--muted`/`--line`, light by default, dark via
`prefers-color-scheme`, override via `data-theme`). Copy pulled straight from `docs/plan/00-THE-PLAN.md`
§0 (the three promises, the "what it is not" line) — if that page's positioning changes, update the
hero and "what it won't become" section here to match, not the other way round.

## Why the join page never puts a name in the URL

`v5/00-charter/04-decisions.md` L-3 and the app's own privacy rule (never put personal data in a
URL) both apply here — the page reads only `?t=<token>`, never a group name or inviter name. If a
future invite-link implementation adds those params for V4-style back-compat, this page must keep
ignoring them, not start rendering them.

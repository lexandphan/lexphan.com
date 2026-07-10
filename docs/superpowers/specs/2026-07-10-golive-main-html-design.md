# Go live: main.html → the real lexphan.com

Date: 2026-07-10
Files: promote `mockups/main.html` to the root site, replacing the current
`index.html` + `styles.css` + `js/gallery.js` + per-album pages + `info.html`.

## Goal
Ship the converged 2026 design (`mockups/main.html`) as the live lexphan.com in one
shot: home masonry (curtains.js WebGL), per-album view + lightbox, info popup, and the
long-press orbit easter egg — generalized from a single-album prototype to all 13 albums,
self-contained (no CDNs), with existing shareable album URLs preserved.

## Current state vs. mockup (the gap)
- **Live now (multi-page):** root `index.html` (13 cover links) + `styles.css` +
  `js/gallery.js`; `album/<name>/index.html` for each of 13 albums; `info.html`;
  `album.html`. Strict CSP (`default-src 'self'; script-src 'self' https://cdnjs...`).
  Real per-album URLs `/album/<name>/` (used by link previews).
- **Mockup (`mockups/main.html`):** one self-contained page, in-page Home/Album/Info
  views via `data-nav`. **Album view hardcodes `ALBUM_FOLDER='kyoto'`** — a single-album
  demo. Loads GSAP 3.12.5 (+ScrollTrigger +Flip) from cdnjs, Lenis 1.1.13 + curtains.js
  8.1.6 from jsdelivr, and 3 Google font families; Three.js r160 vendored. Paths are
  `mockups/`-relative (`../images`, `../assets`, `./vendor`). Carries prototype-only bits
  (proto surface switcher, `window.__eggTrigger/__eggExit/__infoToggle` hooks).

## Decisions (from brainstorming)
1. **Single-page app** — generalize the mockup; one `index.html` drives all views.
2. **Keep real `/album/<name>/` URLs** — thin per-album bootstrap files, each with its
   own link-preview (OG) tags; no shared URL breaks.
3. **Vendor everything, keep strict CSP** — self-host all JS libs + fonts; CSP stays
   `default-src 'self'`.
4. **Album UX** — the mockup's masonry + lightbox, applied uniformly to all 13 albums.
5. **Scope** — everything (home + all albums + info + orbit) in one deploy.

## Architecture / file layout
```
/index.html                  ← Home shell: loads /app.css + /app.js (no data-album)
/app.css                     ← the mockup's inline <style>, extracted (shared source of truth)
/app.js                      ← the mockup's inline <script>s, extracted (+ the three importmap)
/album/<name>/index.html     ← 13 thin bootstraps: set data-album + per-album OG, load /app.css+/app.js
/info.html                   ← minimal redirect to / (info is now a popup; keeps old links alive)
/assets/                     ← favicon + mark svg (exists)
/vendor/                     ← three.module.js (exists) + gsap, ScrollTrigger, Flip, lenis,
                               curtains + /vendor/fonts/*.woff2
/images/<name>/              ← unchanged
/scripts/build-site.py       ← generates the 13 album bootstraps from one template
```
Removed (recoverable via git): old `index.html`, `styles.css`, `js/gallery.js`, old
`album/<name>/index.html`, old `info.html`, `album.html`.

## Album generalization
- The app reads its target album from `<body data-album="<name>">` set by the bootstrap
  file (root `index.html` sets none → Home). A small **counts map** drives the album view
  and lightbox length:
  `{ tahoe:61, cdmxye:22, playa:22, pdt:28, splash:51, kyoto:43, tokyo:30, sapporo:13,
  pv:84, cdmx:33, oax:13, bali:40, japan:31 }` (13 total; mirrors `images/<name>/`).
- Home covers link to `/album/<name>/` (real navigation). Loading `/album/kyoto/` directly
  boots the app straight into that album view; in-app nav (clicking a cover / back to home)
  updates the URL via the History API so Back/Forward and refresh behave.
- `build-site.py` writes each `/album/<name>/index.html` from one template: a tiny HTML
  shell that sets `<body data-album="<name>">`, the per-album `<title>` + OG tags, and links
  the shared `/app.css` + `/app.js`.

## Shared app bundle
To avoid duplicating ~3000 lines across 14 HTML files, extract the mockup's inline
`<style>` → `/app.css` and inline `<script>`s → `/app.js` (+ the three importmap stays in
each HTML `<head>`). `index.html` and every album bootstrap link the same `/app.css` +
`/app.js` — one source of truth, tiny album files. Trade-off vs. the fully-inline mockup:
two extra requests, both same-origin and cacheable — acceptable and cleaner.

## Dependencies & CSP
Vendor into `/vendor/` (pinned to the mockup's versions): GSAP 3.12.5 `gsap.min.js`,
`ScrollTrigger.min.js`, `Flip.min.js`; Lenis 1.1.13; curtains.js 8.1.6 UMD; Three.js r160
(exists). Self-host fonts as `woff2` with local `@font-face`: **Bricolage Grotesque**
(variable, opsz 12–96 / wght 300–700), **Caveat** 600, **Space Mono** 400/700. CSP:
`default-src 'self'; img-src 'self' data:; ...` — no CDN or Google Fonts allowances. All
`<script>`/`<link>`/`@font-face` reference `/vendor/...` only.

## SEO / metadata
- Root `index.html`: `<title>phanny — photo dump</title>`, description, favicon, `lang`,
  viewport, and site OG (`og:image = https://lexphan.com/images/kyoto/cover.jpg`,
  `og:url = https://lexphan.com/`) — carried from today's index.
- Each album bootstrap: `og:title` = "phanny — <Album>", `og:image` =
  `https://lexphan.com/images/<name>/cover.jpg` (each album has a `cover.jpg`),
  `og:url` = `https://lexphan.com/album/<name>/`.

## Strip prototype bits
Remove the proto surface switcher (FINAL/HOME/ALBUM/INFO) and its handlers, the
`window.__eggTrigger` / `__eggExit` / `__infoToggle` test hooks, and any "prototype/Final"
labels. The long-press orbit easter egg stays (hooks removed).

## Rollout (safety)
Do all work on a `golive` branch. Preview via `python3 -m http.server` and **hard-refresh**
through every path before merging. Merge to `main` (what GitHub Pages deploys) only after
verification; the previous site is fully recoverable via `git revert`. Because the domain is
live, the merge is the single go-live moment — verify first, then one atomic merge.

## Testing checklist
- Home: masonry lays out, covers load, hover/spotlight, reshuffle (Flip), scroll-reveal.
- Albums: all 13 `/album/<name>/` load directly AND via home-cover click; correct image
  count; lightbox open/next/prev/close, keyboard + focus trap; Back/Forward + refresh.
- Info popup opens/closes; `/info.html` redirects to `/`.
- Orbit: long-press launches; drag/zoom/focus/reset; exit restores masonry (curtains
  rebuild); Esc/wordmark exit.
- `prefers-reduced-motion`: calm fallbacks. WebGL-disabled: DOM-cover fallback grid.
- Desktop + mobile widths; **no console errors; zero CSP violations**; no external requests.

## Non-goals
No redesign of the visual language (that's the mockup, done). No CMS/build framework
(stays static, no npm). No change to the photo set, `images/` layout, or `add-album.py`
import flow. No analytics.

## Risks / watch-items
- **CSP breakage from vendoring** — a missed `/vendor` path or an inline handler trips the
  strict CSP; test with devtools CSP reporting.
- **curtains↔orbit WebGL** — the exit-rebuild fix (already in main.html) must survive the
  refactor into `/app.js`.
- **History routing on a static host** — `/album/<name>/` must be real files (they are), so
  deep links + refresh work without a server rewrite.
- **Font FOUT/mismatch** — self-hosted variable Bricolage must cover the weights the design
  uses; verify the wordmark (Caveat) and mono metadata render identically to the mockup.
- **Two extra requests** (`app.css`/`app.js`) — same-origin, cached; negligible.

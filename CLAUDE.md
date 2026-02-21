# phanny — Claude context

## What this project is
Personal film photography site at lexphan.com. Static HTML/CSS/JS, no framework, no build step. Hosted on GitHub Pages.

## Key files
- `index.html` — homepage, album cover grid (mobile: infinite swipe carousel; desktop: scattered layout)
- `info.html` — contact + camera page
- `styles.css` — all styles (single file)
- `js/gallery.js` — all JS: scattered layout, infinite carousel, lightbox, anime.js springs
- `album/<name>/index.html` — one file per album; images loaded dynamically via `data-count` on `<main>`
- `images/<name>/` — JPGs numbered 1.jpg, 2.jpg, …

## Tech conventions
- No npm, no bundler — plain static files
- anime.js v3 loaded lazily from CDN via `loadAnime()` in gallery.js
- Album image count set via `data-count` on `<main id="gallery">`
- All wordmarks are inline SVG with `overflow="visible"` and `y="60"` baseline
- Mobile index page: horizontal scroll-snap carousel with prepended/appended clones for infinite loop; `getBoundingClientRect` used for centering (not offsetLeft) because gallery is `position: static` on mobile
- Desktop album pages: scattered absolute-position layout with anime.js spring hover; hover scale uses `!important` to override inline transforms

## Preferences
- Concise responses, no emojis
- Ask before committing or pushing unless explicitly told to publish
- Prefer editing existing files over creating new ones
- Don't add comments unless logic is non-obvious

# phanny

A small, ongoing archive of film photos — light, travel, and the in-between.

Live at [lexphan.com](https://lexphan.com)

---

## Tech stack

- Plain HTML, CSS, JavaScript — no build step
- Hosted on GitHub Pages (`CNAME` → lexphan.com)
- `js/gallery.js` handles all layout, animation, and lightbox logic
- anime.js v3 loaded lazily from CDN for spring animations
- **WebP-only images** (universally supported since ~2020). The TIFF/RAW masters
  are the real archive and live off-repo; only web-sized WebP is committed. One
  small `cover.jpg` per album is kept for social/OG previews.

## Project structure

```
/
├── index.html              # Homepage — scattered gallery of album covers
├── info.html               # Contact + camera info
├── styles.css              # All styles (single file)
├── js/
│   └── gallery.js          # Layout, carousel, lightbox, animations
├── assets/
│   ├── phanny-favicon.svg
│   ├── phanny-mark.svg
│   └── phanny-wordmark.svg
├── album/
│   └── <name>/
│       └── index.html      # One page per album; images loaded dynamically
├── images/
│   └── <name>/             # WebP numbered sequentially: 1.webp, 2.webp, … + cover.jpg
└── scripts/
    ├── add-album.py        # Import scans (TIFF/JPEG) → WebP album  ← use this
    ├── renumber-album.sh   # Renumbers photos in sequence (webp + jpg lockstep)
    └── generate-webp.sh    # Legacy JPEG→WebP converter (add-album.py is preferred)
```

## Adding a new album

One command turns a folder of scans into a finished album:

```bash
python3 scripts/add-album.py <slug> "/path/to/scans" --title "Label" --cover 1
```

It converts each source (TIFF/JPEG/PNG) → sRGB (fixes Adobe-RGB dullness) →
orientation baked into pixels (so nothing shows sideways) → long edge capped at
2560px → `images/<slug>/1.webp…N.webp`, writes `cover.jpg` for OG previews, and
scaffolds `album/<slug>/index.html` with the right `data-count`. It then prints
the `<a>` cover snippet to paste into `index.html` (newest first).

Options: `--max 2560` (long edge), `--quality 82`, `--append` (add to an existing
album), `--dry-run`. Requires `pip install Pillow`.

Then push to `main` — GitHub Pages deploys automatically.

## Deployment

Push to `main`. GitHub Pages serves the root of this repo.

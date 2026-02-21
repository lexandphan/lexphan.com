# phanny

A small, ongoing archive of film photos — light, travel, and the in-between.

Live at [lexphan.com](https://lexphan.com)

---

## Tech stack

- Plain HTML, CSS, JavaScript — no build step
- Hosted on GitHub Pages (`CNAME` → lexphan.com)
- `js/gallery.js` handles all layout, animation, and lightbox logic
- anime.js v3 loaded lazily from CDN for spring animations

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
│   └── <name>/             # JPGs numbered sequentially: 1.jpg, 2.jpg, …
└── scripts/
    ├── renumber-album.sh   # Renumbers images in sequence
    └── generate-webp.sh    # Generates WebP versions
```

## Adding a new album

1. Create `images/<name>/` and add numbered JPGs (`1.jpg`, `2.jpg`, …)
2. Copy an existing album page to `album/<name>/index.html` — update the title, description, OG tags, and the `data-count` attribute on `<main>` to match the image count
3. Add a cover link in `index.html`:
   ```html
   <a href="album/<name>/">
     <img src="images/<name>/<cover-number>.jpg" alt="<Label>" />
   </a>
   ```
4. Push to `main` — GitHub Pages deploys automatically

## Deployment

Push to `main`. GitHub Pages serves the root of this repo.

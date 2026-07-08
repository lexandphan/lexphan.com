#!/usr/bin/env python3
"""
add-album.py — import scanned photos into a phanny album (WebP-only).

Pipeline, per photo:
  source (TIFF/JPEG/PNG)
    -> bake EXIF orientation into pixels   (ImageOps.exif_transpose)
    -> convert embedded profile -> sRGB    (ImageCms; fixes Adobe-RGB "dull colors")
    -> resize long edge <= --max (no upscale, LANCZOS)
    -> WebP  images/<slug>/<n>.webp
Photos are numbered sequentially 1..N in natural filename order, so gaps in the
source names (e.g. tahoe_1..tahoe_62 with one missing) collapse to a clean 1..N.
Also writes images/<slug>/cover.jpg (small sRGB JPEG) for social/OG previews,
and scaffolds album/<slug>/index.html.

WebP is universally supported (Safari 14+, 2020); we intentionally do NOT keep a
full JPEG per photo — the TIFF masters are your archive and live off-repo.

Requires: Pillow  (pip install Pillow)
Usage:
  python3 scripts/add-album.py <slug> <source-dir> [options]
Options:
  --cover N          frame (1-based, in final numbering) to use as cover.jpg  [default: 1]
  --title "Text"     name for <title>/OG tags (not shown on the page)          [default: Slug]
  --max PX           long-edge cap for web WebP                                 [default: 2560]
  --quality Q        WebP quality 0-100                                         [default: 82]
  --append           add to an existing album, continuing the numbering
  --dry-run          print the plan, write nothing
"""
import argparse, io, os, re, sys

try:
    from PIL import Image, ImageOps, ImageCms
except ImportError:
    sys.exit("Pillow is required:  pip install Pillow")

SLUG_RE = re.compile(r"^[a-z0-9_-]+$")
EXTS = (".tif", ".tiff", ".jpg", ".jpeg", ".png")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def natkey(name):
    """Natural sort: tahoe_2 before tahoe_10."""
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", name)]


def gather(src_dir):
    files = [e for e in os.listdir(src_dir) if e.lower().endswith(EXTS) and not e.startswith(".")]
    files.sort(key=natkey)
    return [os.path.join(src_dir, f) for f in files]


def to_srgb(im):
    icc = im.info.get("icc_profile")
    if icc:
        try:
            src = ImageCms.ImageCmsProfile(io.BytesIO(icc))
            dst = ImageCms.createProfile("sRGB")
            return ImageCms.profileToProfile(im, src, dst, outputMode="RGB",
                                             renderingIntent=ImageCms.Intent.PERCEPTUAL)
        except ImageCms.PyCMSError:
            pass  # unreadable profile -> fall through to a plain convert
    return im.convert("RGB")


def fit(im, max_px):
    w, h = im.size
    if max(w, h) <= max_px:
        return im
    if w >= h:
        return im.resize((max_px, round(h * max_px / w)), Image.LANCZOS)
    return im.resize((round(w * max_px / h), max_px), Image.LANCZOS)


def load_web(path, max_px):
    im = Image.open(path)
    im = ImageOps.exif_transpose(im)   # bake orientation; no-op when already upright
    im = to_srgb(im)
    im = fit(im, max_px)
    return im


ALBUM_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:;">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{title} — phanny</title>
  <meta name="description" content="Film photos from {title} by phanny." />
  <meta property="og:title" content="{title} — phanny" />
  <meta property="og:description" content="Film photos from {title} by phanny." />
  <meta property="og:image" content="https://lexphan.com/images/{slug}/cover.jpg" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://lexphan.com/album/{slug}/" />
  <link rel="preload" as="image" href="../../images/{slug}/1.webp" type="image/webp">
  <link rel="preload" as="image" href="../../images/{slug}/2.webp" type="image/webp">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Caveat:wght@600&display=swap" rel="stylesheet">
  <link rel="icon" type="image/svg+xml" href="/assets/phanny-favicon.svg">
  <link rel="stylesheet" href="../../styles.css" />
</head>
<body class="album-page">
  <header>
    <h1>
      <a href="/">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 80" width="140" height="40" overflow="visible" aria-label="phanny">
          <text x="0" y="60" font-family="Caveat, cursive" font-weight="600" font-size="72" letter-spacing="-0.01em" fill="#1B1814">phanny</text>
        </svg>
      </a>
    </h1>
    <nav>
      <a href="/info.html" title="info">
        <img src="/assets/phanny-mark.svg" alt="info" width="28" height="28">
      </a>
    </nav>
  </header>

  <main id="gallery" class="scattered-gallery" data-count="{count}" aria-label="{title} photos"></main>

  <div id="lightbox" class="lightbox" role="dialog" aria-modal="true" aria-label="Image viewer" aria-hidden="true">
    <div id="lightbox-swipe-area">
      <img id="lightbox-img" src="" alt="" />
    </div>
  </div>

  <script defer src="../../js/gallery.js"></script>
</body>
</html>
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("source")
    ap.add_argument("--cover", type=int, default=1)
    ap.add_argument("--title", default=None)
    ap.add_argument("--max", type=int, default=2560)
    ap.add_argument("--quality", type=int, default=82)
    ap.add_argument("--append", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    if not SLUG_RE.match(a.slug):
        sys.exit(f"Invalid slug '{a.slug}': lowercase letters, numbers, - and _ only")
    if not os.path.isdir(a.source):
        sys.exit(f"Source dir not found: {a.source}")
    title = a.title or a.slug.capitalize()

    images_dir = os.path.join(REPO, "images", a.slug)
    album_dir = os.path.join(REPO, "album", a.slug)

    existing = []
    if os.path.isdir(images_dir):
        existing = [f for f in os.listdir(images_dir) if re.match(r"^\d+\.webp$", f)]
    if existing and not a.append:
        sys.exit(f"images/{a.slug} already has {len(existing)} photos. Use --append to add more.")
    start = (max(int(f.split(".")[0]) for f in existing) + 1) if existing else 1

    sources = gather(a.source)
    if not sources:
        sys.exit(f"No {'/'.join(EXTS)} files in {a.source}")

    print(f"album  : {a.slug}   title '{title}'")
    print(f"source : {a.source}  ({len(sources)} files)")
    print(f"output : images/{a.slug}/{start}.webp .. {start + len(sources) - 1}.webp  "
          f"(max {a.max}px, q{a.quality}, WebP-only)")
    print(f"cover  : frame {a.cover} -> images/{a.slug}/cover.jpg")
    if a.dry_run:
        for i, s in enumerate(sources):
            print(f"  {start+i:>3}.webp  <-  {os.path.basename(s)}")
        return

    os.makedirs(images_dir, exist_ok=True)
    cover_src = None
    total_kb = 0
    for i, s in enumerate(sources):
        idx = start + i
        im = load_web(s, a.max)
        out = os.path.join(images_dir, f"{idx}.webp")
        im.save(out, "WEBP", quality=a.quality, method=6)
        kb = os.path.getsize(out) / 1024
        total_kb += kb
        if idx == a.cover:
            cover_src = im.copy()
        print(f"  {idx:>3}.webp  {im.size[0]}x{im.size[1]}  {kb:6.0f} KB   <- {os.path.basename(s)}")

    # OG cover: small sRGB JPEG (scrapers handle JPEG/PNG more reliably than WebP)
    if cover_src is None:  # cover index outside this batch (e.g. --append); reload it
        cover_src = load_web(sources[0], a.max)
    cover = cover_src.copy()
    cover.thumbnail((1200, 1200), Image.LANCZOS)
    cover.save(os.path.join(images_dir, "cover.jpg"), "JPEG", quality=86, optimize=True)

    count = start + len(sources) - 1
    os.makedirs(album_dir, exist_ok=True)
    with open(os.path.join(album_dir, "index.html"), "w") as f:
        f.write(ALBUM_TEMPLATE.format(title=title, slug=a.slug, count=count))

    print(f"\nWrote {len(sources)} WebP ({total_kb/1024:.1f} MB) + cover.jpg + album/{a.slug}/index.html")
    print(f"data-count={count}\n")
    print("Add this cover to index.html's <main id=\"gallery\"> (newest first):\n")
    print(f'    <a href="album/{a.slug}/">\n'
          f'      <img src="images/{a.slug}/{a.cover}.webp" width="600" height="400" '
          f'loading="lazy" decoding="async" alt="{title}" />\n'
          f'    </a>')


if __name__ == "__main__":
    main()

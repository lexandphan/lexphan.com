#!/usr/bin/env python3
"""Generate grid-size WebP renditions: images/<album>/g/N.webp at <=1280px long edge.

The masters (images/<album>/N.webp, ~2560px, ~559KB avg) stay untouched and remain
what the lightbox shows full-res. The g/ renditions (~1280px, q72) are what the album
grid, home covers, hover-peek, and the orbit stream load — cutting transfer ~75-80%
and decode ~4x on the browsing paths. Masters were already sRGB + orientation-baked
by add-album.py, so a plain resize is safe here.

Run after adding photos (alongside gen-aspects.py). Skips files whose rendition is
already newer than its master, so re-runs are cheap."""
import os, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LONG_EDGE = 1280
QUALITY = 72

def scan_albums(root):
    """Counts from the filesystem (contiguous 1..N.webp per album folder)."""
    albums = {}
    imgdir = os.path.join(root, "images")
    for folder in sorted(os.listdir(imgdir)):
        d = os.path.join(imgdir, folder)
        if not os.path.isdir(d):
            continue
        n = 0
        while os.path.exists(os.path.join(d, f"{n + 1}.webp")):
            n += 1
        if n:
            albums[folder] = n
    return albums

COUNTS = scan_albums(ROOT)

made = skipped = failed = 0
src_bytes = out_bytes = 0
for folder, n in COUNTS.items():
    outdir = os.path.join(ROOT, "images", folder, "g")
    os.makedirs(outdir, exist_ok=True)
    for i in range(1, n + 1):
        src = os.path.join(ROOT, "images", folder, f"{i}.webp")
        dst = os.path.join(outdir, f"{i}.webp")
        try:
            if os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src):
                skipped += 1
                continue
            im = Image.open(src)
            w, h = im.size
            scale = min(1.0, LONG_EDGE / max(w, h))
            if scale < 1.0:
                im = im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
            im.save(dst, "WEBP", quality=QUALITY, method=6)
            made += 1
            src_bytes += os.path.getsize(src)
            out_bytes += os.path.getsize(dst)
        except Exception as e:
            failed += 1
            print(f"FAIL {folder}/{i}.webp -> {e}", file=sys.stderr)

print(f"renditions: {made} made, {skipped} up-to-date, {failed} failed")
if made:
    print(f"bytes: {src_bytes/1e6:.1f} MB masters -> {out_bytes/1e6:.1f} MB renditions "
          f"({100*out_bytes/max(1,src_bytes):.0f}%)")
if failed:
    sys.exit(1)

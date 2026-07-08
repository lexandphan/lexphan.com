#!/usr/bin/env python3
"""
migrate-webp-only.py — one-time migration of the existing albums to WebP-only.

For every page that references an image JPEG in its og:image tag it:
  1. generates images/<slug>/cover.jpg (~1200px sRGB) from that frame, if missing,
  2. repoints the og:image to .../cover.jpg,
then deletes every numbered N.jpg across images/ (cover.jpg is kept).

WebP already backs every photo, so this only removes the never-served JPEG copies.
Dry-run by default; pass --apply to actually write/delete. Fully reversible until
committed (git checkout / git restore).

NOTE: this shrinks the working tree + deploy, but the ~817 MB already in git
history is only reclaimed by a one-time history rewrite (see the printed note).

Requires: Pillow
"""
import argparse, os, re, sys

try:
    from PIL import Image, ImageOps, ImageCms
except ImportError:
    sys.exit("Pillow is required:  pip install Pillow")

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OG_RE = re.compile(r'(og:image"\s+content="https://lexphan\.com/)images/([a-z0-9_-]+)/(\d+)\.jpg(")')


def html_files():
    out = [os.path.join(REPO, "index.html"), os.path.join(REPO, "info.html")]
    album = os.path.join(REPO, "album")
    for slug in sorted(os.listdir(album)):
        p = os.path.join(album, slug, "index.html")
        if os.path.isfile(p):
            out.append(p)
    return [p for p in out if os.path.isfile(p)]


def make_cover(slug, frame, apply):
    """Generate images/<slug>/cover.jpg from a numbered frame (jpg or webp)."""
    d = os.path.join(REPO, "images", slug)
    dst = os.path.join(d, "cover.jpg")
    if os.path.exists(dst):
        return "cover.jpg exists"
    src = None
    for ext in ("jpg", "webp"):
        cand = os.path.join(d, f"{frame}.{ext}")
        if os.path.exists(cand):
            src = cand
            break
    if not src:
        return f"!! no source frame {frame} in images/{slug}"
    if not apply:
        return f"would make cover.jpg from {os.path.basename(src)}"
    im = ImageOps.exif_transpose(Image.open(src))
    icc = im.info.get("icc_profile")
    if icc:
        try:
            im = ImageCms.profileToProfile(im, ImageCms.ImageCmsProfile(__import__("io").BytesIO(icc)),
                                           ImageCms.createProfile("sRGB"), outputMode="RGB")
        except ImageCms.PyCMSError:
            im = im.convert("RGB")
    else:
        im = im.convert("RGB")
    im.thumbnail((1200, 1200), Image.LANCZOS)
    im.save(dst, "JPEG", quality=86, optimize=True)
    return f"made cover.jpg from {os.path.basename(src)}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write/delete for real (default: dry-run)")
    a = ap.parse_args()
    mode = "APPLY" if a.apply else "DRY-RUN (pass --apply to execute)"
    print(f"=== migrate to WebP-only — {mode} ===\n")

    # 1) covers + og repoint
    for p in html_files():
        txt = open(p).read()
        seen = set()
        for m in OG_RE.finditer(txt):
            slug, frame = m.group(2), m.group(3)
            if (slug, frame) not in seen:
                seen.add((slug, frame))
                print(f"  {os.path.relpath(p, REPO):32} og:image images/{slug}/{frame}.jpg -> cover.jpg  [{make_cover(slug, frame, a.apply)}]")
        new = OG_RE.sub(r"\1images/\2/cover.jpg\4", txt)
        if new != txt and a.apply:
            open(p, "w").write(new)

    # 2) remove numbered jpgs (keep cover.jpg)
    freed = 0
    count = 0
    for root, _, files in os.walk(os.path.join(REPO, "images")):
        for f in files:
            if re.match(r"^\d+\.jpg$", f):
                fp = os.path.join(root, f)
                freed += os.path.getsize(fp)
                count += 1
                if a.apply:
                    os.remove(fp)
    print(f"\n  {'removed' if a.apply else 'would remove'} {count} numbered JPEGs  ({freed/1048576:.0f} MB from the working tree)")

    if not a.apply:
        print("\nDry-run only — nothing changed. Re-run with --apply when ready.")
    else:
        print("\nDone. Review with `git status` before committing.")
    print(
        "\nTo also reclaim the JPEGs already in git history (one-time, rewrites\n"
        "history + force-push — do it when you have a clean working tree):\n"
        "  brew install git-filter-repo\n"
        "  git filter-repo --path-glob 'images/*/[0-9]*.jpg' --invert-paths\n"
        "  git push --force origin main\n"
        "(Back up / re-clone first; this changes every commit hash.)"
    )


if __name__ == "__main__":
    main()

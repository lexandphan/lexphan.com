#!/usr/bin/env python3
"""Curation helper: remove or rotate photos in an album, keeping masters and g/
renditions in lockstep, then regenerate the manifest + bootstraps.

  python3 scripts/curate.py remove <album> <n> [n ...]   # delete + renumber contiguous
  python3 scripts/curate.py rotate <album> <n> [n ...]   # 90° counterclockwise

Numbers refer to CURRENT indices. After a removal, home covers referencing the
album in app.js COVERS may need their index shifted — the script prints a
reminder with the new index. Run rotations BEFORE removals if doing both."""
import os, sys, subprocess
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def count(album):
    d = os.path.join(ROOT, "images", album)
    n = 0
    while os.path.exists(os.path.join(d, f"{n + 1}.webp")):
        n += 1
    return n

def rotate(album, nums):
    d = os.path.join(ROOT, "images", album)
    for i in nums:
        p = os.path.join(d, f"{i}.webp")
        im = Image.open(p)
        im = im.transpose(Image.ROTATE_90)   # counterclockwise
        im.save(p, "WEBP", quality=88, method=6)
        print(f"rotated {album}/{i}.webp -> {im.size[0]}x{im.size[1]}")
    # gen-grid remakes the g/ renditions via mtime

def remove(album, nums):
    d = os.path.join(ROOT, "images", album)
    n = count(album)
    rm = set(nums)
    bad = [i for i in rm if i < 1 or i > n]
    if bad:
        sys.exit(f"out of range for {album} (1..{n}): {bad}")
    for i in sorted(rm):
        os.remove(os.path.join(d, f"{i}.webp"))
        os.remove(os.path.join(d, "g", f"{i}.webp"))
        print(f"removed {album}/{i}.webp (+ g/)")
    new = 0
    for old in range(1, n + 1):
        if old in rm:
            continue
        new += 1
        if new != old:
            os.rename(os.path.join(d, f"{old}.webp"), os.path.join(d, f"{new}.webp"))
            os.rename(os.path.join(d, "g", f"{old}.webp"), os.path.join(d, "g", f"{new}.webp"))
    masters = sorted(int(f[:-5]) for f in os.listdir(d) if f.endswith(".webp") and f[:-5].isdigit())
    grids = sorted(int(f[:-5]) for f in os.listdir(os.path.join(d, "g")) if f.endswith(".webp"))
    assert masters == list(range(1, new + 1)) == grids, "renumber mismatch!"
    print(f"{album}: now 1..{new} contiguous")
    # remind about the home cover index
    app = open(os.path.join(ROOT, "app.js")).read()
    import re
    m = re.search(r"p: '" + album + r"/(\d+)'", app)
    if m:
        old_cover = int(m.group(1))
        if old_cover in rm:
            print(f"!! COVERS uses {album}/{old_cover}, which was REMOVED — pick a new cover in app.js")
        else:
            shift = sum(1 for i in rm if i < old_cover)
            if shift:
                print(f"!! COVERS: update app.js '{album}/{old_cover}' -> '{album}/{old_cover - shift}'")

def main():
    if len(sys.argv) < 4 or sys.argv[1] not in ("remove", "rotate"):
        sys.exit(__doc__)
    cmd, album = sys.argv[1], sys.argv[2]
    nums = [int(x) for x in sys.argv[3:]]
    if not os.path.isdir(os.path.join(ROOT, "images", album)):
        sys.exit(f"no such album: {album}")
    if cmd == "rotate":
        rotate(album, nums)
    else:
        remove(album, nums)
    for script in ("gen-grid.py", "gen-aspects.py", "build-site.py"):
        out = subprocess.run([sys.executable, os.path.join(ROOT, "scripts", script)],
                             capture_output=True, text=True)
        print(out.stdout.strip().splitlines()[-1] if out.stdout.strip() else script)
        if out.returncode != 0:
            sys.exit(out.stderr)

if __name__ == "__main__":
    main()

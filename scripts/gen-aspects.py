#!/usr/bin/env python3
"""Read every album image's aspect ratio (width/height) into /album-aspects.js so the
album grid can reserve each frame's exact height BEFORE the image loads — which removes
the lazy-load layout-shift that made mobile album scroll choppy.

Output: window.ALBUM_ASPECTS = { "<folder>": [r1, r2, ...], ... }  (r = round(w/h, 4),
indexed by image number 1..N -> array position 0..N-1). Re-run after adding photos."""
import os, json
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COUNTS = {"tahoe": 61, "cdmxye": 22, "playa": 22, "pdt": 28, "splash": 51, "kyoto": 43,
          "tokyo": 30, "sapporo": 13, "pv": 84, "cdmx": 33, "oax": 13, "bali": 40, "japan": 31}

out = {}
missing = 0
for folder, n in COUNTS.items():
    ratios = []
    for i in range(1, n + 1):
        p = os.path.join(ROOT, "images", folder, f"{i}.webp")
        try:
            w, h = Image.open(p).size
            ratios.append(round(w / h, 4))
        except Exception as e:
            ratios.append(1.5)  # 3:2 fallback if unreadable/missing
            missing += 1
            print(f"warn: {folder}/{i}.webp -> {e}")
    out[folder] = ratios

js = "window.ALBUM_ASPECTS = " + json.dumps(out, separators=(",", ":")) + ";\n"
open(os.path.join(ROOT, "album-aspects.js"), "w").write(js)
print(f"wrote album-aspects.js: {sum(len(v) for v in out.values())} ratios "
      f"across {len(out)} albums, {len(js)} bytes, {missing} fallback(s)")

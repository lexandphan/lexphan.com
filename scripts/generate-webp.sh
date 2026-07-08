#!/usr/bin/env bash
# generate-webp.sh
# Converts numbered album JPEGs to WebP. Regenerates when the JPEG is newer than
# its WebP (pass --force to rebuild everything). Prefer scripts/add-album.py for
# new imports — it caps dimensions and color-manages TIFF/Adobe-RGB sources.
# Requires: cwebp (brew install webp)
# Usage: bash scripts/generate-webp.sh [--force]

set -euo pipefail

IMAGES_DIR="$(cd "$(dirname "$0")/.." && pwd)/images"
FORCE="${1:-}"

if ! command -v cwebp &>/dev/null; then
  echo "Error: cwebp not found. Install with: brew install webp"
  exit 1
fi

total=0
converted=0

# find (not a ** glob, which isn't recursive under macOS bash 3.2) and NUL-safe read.
while IFS= read -r -d '' jpg; do
  webp="${jpg%.*}.webp"
  total=$((total + 1))
  if [ -f "$webp" ] && [ "$FORCE" != "--force" ] && [ ! "$jpg" -nt "$webp" ]; then
    continue
  fi
  cwebp -q 85 "$jpg" -o "$webp" -quiet
  converted=$((converted + 1))
  echo "  converted: $jpg -> $(basename "$webp")"
done < <(find "$IMAGES_DIR" -type f -name '[0-9]*.jpg' -print0)

echo ""
echo "Done. (Re)generated $converted of $total numbered JPEGs to WebP."

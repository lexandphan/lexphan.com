#!/usr/bin/env bash
# generate-webp.sh
# Converts all album JPEG images to WebP format for improved performance.
# Requires: cwebp (from libwebp) or ffmpeg
#
# Install on macOS: brew install webp
# Usage: bash scripts/generate-webp.sh

set -euo pipefail

IMAGES_DIR="$(cd "$(dirname "$0")/.." && pwd)/images"

if ! command -v cwebp &>/dev/null; then
  echo "Error: cwebp not found. Install with: brew install webp"
  exit 1
fi

total=0
converted=0

for jpg in "$IMAGES_DIR"/**/*.jpg "$IMAGES_DIR"/**/*.jpeg; do
  [ -f "$jpg" ] || continue
  webp="${jpg%.*}.webp"
  total=$((total + 1))
  if [ -f "$webp" ]; then
    echo "  skip (exists): $webp"
    continue
  fi
  cwebp -q 85 "$jpg" -o "$webp" -quiet
  converted=$((converted + 1))
  echo "  converted: $(basename "$jpg") -> $(basename "$webp")"
done

echo ""
echo "Done. Converted $converted / $total images to WebP."
echo ""
echo "To serve WebP automatically, use <picture> elements in your HTML or"
echo "configure your server to serve .webp when supported."

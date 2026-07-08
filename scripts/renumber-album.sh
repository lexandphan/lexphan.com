#!/usr/bin/env bash
set -euo pipefail
# Renumber an album's photos to a contiguous 1..N (natural order), keeping each
# .webp and its optional .jpg sibling in lockstep. cover.jpg is left untouched.

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <album-slug>"
  echo "Example: $0 kyoto"
  exit 1
fi

album_slug="$1"
if [[ ! "$album_slug" =~ ^[a-z0-9_-]+$ ]]; then
  echo "Invalid album slug: lowercase letters, numbers, hyphens, and underscores only"
  exit 1
fi

album_dir="images/$album_slug"
if [[ ! -d "$album_dir" ]]; then
  echo "Album directory not found: $album_dir"
  exit 1
fi

# WebP is the canonical served file, so drive the numbering off it.
mapfile -t stems < <(find "$album_dir" -maxdepth 1 -type f -name '[0-9]*.webp' \
  -exec basename {} .webp \; | sort -n)

if [[ ${#stems[@]} -eq 0 ]]; then
  echo "No numbered .webp files found in $album_dir"
  exit 1
fi

# Two-phase rename prevents collisions (e.g. target 1.webp already exists).
i=0
for s in "${stems[@]}"; do
  i=$((i + 1))
  for ext in webp jpg; do
    [[ -f "$album_dir/$s.$ext" ]] && mv "$album_dir/$s.$ext" "$album_dir/.tmp-renumber-$i.$ext"
  done
done

for j in $(seq 1 "$i"); do
  for ext in webp jpg; do
    [[ -f "$album_dir/.tmp-renumber-$j.$ext" ]] && mv "$album_dir/.tmp-renumber-$j.$ext" "$album_dir/$j.$ext"
  done
done

echo "Renumbered ${#stems[@]} photos in $album_dir -> 1.webp to ${i}.webp (jpg siblings moved in lockstep)"
echo "Remember to update data-count=\"${i}\" in album/$album_slug/index.html"

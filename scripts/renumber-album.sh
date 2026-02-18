#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <album-slug>"
  echo "Example: $0 kyoto"
  exit 1
fi

album_slug="$1"
album_dir="images/$album_slug"

if [[ ! -d "$album_dir" ]]; then
  echo "Album directory not found: $album_dir"
  exit 1
fi

mapfile -t files < <(find "$album_dir" -maxdepth 1 -type f \( -iname "*.jpg" -o -iname "*.jpeg" \) \
  | sort -V)

if [[ ${#files[@]} -eq 0 ]]; then
  echo "No .jpg/.jpeg files found in $album_dir"
  exit 1
fi

# Two-phase rename prevents collisions (e.g., 1.jpg already exists).
for i in "${!files[@]}"; do
  src="${files[$i]}"
  tmp="$album_dir/.tmp-renumber-$((i + 1)).jpg"
  mv "$src" "$tmp"
done

mapfile -t tmp_files < <(find "$album_dir" -maxdepth 1 -type f -name ".tmp-renumber-*.jpg" | sort -V)

for i in "${!tmp_files[@]}"; do
  src="${tmp_files[$i]}"
  dst="$album_dir/$((i + 1)).jpg"
  mv "$src" "$dst"
done

echo "Renumbered ${#files[@]} images in $album_dir -> 1.jpg to ${#files[@]}.jpg"

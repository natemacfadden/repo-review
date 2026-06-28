#!/usr/bin/env bash
# fail on non-ascii bytes, except box-drawing glyphs (U+2500-257F) used in
# file-layout diagrams. operates on git-tracked and untracked-but-not-ignored
# files, so vendored/generated dirs (node_modules) are skipped.
set -uo pipefail
cd "$(dirname "$0")/.."

allow='\x{2500}-\x{257F}'

# tracked + untracked, respecting .gitignore; fall back to find outside git
if git rev-parse --git-dir >/dev/null 2>&1; then
  mapfile -d '' files < <(git ls-files -z --cached --others --exclude-standard)
else
  mapfile -d '' files < <(find . -type f -not -path './.git/*' -print0)
fi

# drop listed-but-absent paths (e.g. a tracked file deleted in the working tree)
existing=()
for f in "${files[@]}"; do [ -f "$f" ] && existing+=("$f"); done
files=("${existing[@]}")

if [ ${#files[@]} -eq 0 ]; then echo "asciicheck: no files"; exit 0; fi

# -I skips binary files; /dev/null forces filename:line output for a lone file
if grep -InP "[^\x00-\x7F${allow}]" "${files[@]}" /dev/null; then
  echo "asciicheck: non-ascii characters found (see above)" >&2
  exit 1
fi
echo "asciicheck: clean"

#!/usr/bin/env bash
# fail on non-ascii bytes, except box-drawing glyphs (U+2500-257F) used in
# file-layout diagrams
set -euo pipefail

allow='\x{2500}-\x{257F}'

if grep -rnP --exclude-dir=.git "[^\x00-\x7F${allow}]" .; then
  echo "asciicheck: non-ascii characters found (see above)" >&2
  exit 1
fi
echo "asciicheck: clean"

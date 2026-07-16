#!/usr/bin/env bash
# fail on non-ascii bytes, except box-drawing glyphs (U+2500-257F) used in
# file-layout diagrams. operates on git-tracked and untracked-but-not-ignored
# files, so vendored/generated dirs (node_modules) are skipped. portable across
# Linux and macOS: no bash-4 mapfile, no GNU-grep -P.
set -uo pipefail
cd "$(dirname "$0")/.."

allow='\x{2500}-\x{257F}'

# tracked + untracked, respecting .gitignore; fall back to find outside git.
# read -d '' (not mapfile) so this works on macOS's bash 3.2.
files=()
if git rev-parse --git-dir >/dev/null 2>&1; then
  while IFS= read -r -d '' f; do files+=("$f"); done \
    < <(git ls-files -z --cached --others --exclude-standard)
else
  while IFS= read -r -d '' f; do files+=("$f"); done \
    < <(find . -type f -not -path './.git/*' -print0)
fi

# drop listed-but-absent paths (e.g. a tracked file deleted in the working tree)
existing=()
for f in "${files[@]}"; do [ -f "$f" ] && existing+=("$f"); done
files=("${existing[@]}")

if [ ${#files[@]} -eq 0 ]; then echo "asciicheck: no files"; exit 0; fi

# perl (ships with Linux + macOS) instead of GNU-grep -P, which BSD grep lacks.
# skip binary files (NUL byte), decode UTF-8, and print file:line for any char
# outside ASCII and the allowed box-drawing range. exit 0 = found (grep-style).
if ALLOW="$allow" perl -e '
  use strict; use warnings;
  binmode(STDOUT, ":encoding(UTF-8)");
  my $allow = $ENV{ALLOW};
  my $found = 0;
  for my $f (@ARGV) {
    open(my $fh, "<:raw", $f) or next;
    local $/; my $raw = <$fh>; close $fh;
    defined $raw or next;
    next if index($raw, "\x00") >= 0;
    my $text;
    eval { require Encode; $text = Encode::decode("UTF-8", $raw, Encode::FB_CROAK()); 1 }
      or $text = $raw;
    my $n = 0;
    for my $line (split /\n/, $text, -1) {
      $n++;
      if ($line =~ /[^\x00-\x7F$allow]/) { print "$f:$n:$line\n"; $found = 1; }
    }
  }
  exit($found ? 0 : 1);
' "${files[@]}"; then
  echo "asciicheck: non-ascii characters found (see above)" >&2
  exit 1
fi
echo "asciicheck: clean"

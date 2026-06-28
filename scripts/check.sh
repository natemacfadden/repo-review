#!/usr/bin/env bash
# repo-review dev/CI checks - the single entry point run both locally and in CI.
# Runs every check, COLLECTING failures instead of halting on the first, prints
# per-check diagnostics, and exits non-zero if any failed. Tools that aren't
# installed are skipped (not failed) so a partial local env still reports.
#
# deliberately NOT `set -e` - we want every check to run
set -uo pipefail
shopt -s nullglob
cd "$(dirname "$0")/.."

fails=0
section() { printf '\n== %s ==\n' "$1"; }
ok()   { printf 'PASS: %s\n' "$1"; }
bad()  { printf 'FAIL: %s\n' "$1"; fails=$((fails + 1)); }
skip() { printf 'SKIP: %s\n' "$1"; }

# 1. ascii (box-drawing allowed; everything else must be ascii)
section "ascii"
if bash scripts/asciicheck.sh; then ok ascii; else bad ascii; fi

# 2. editorconfig (line width, whitespace, final newline)
section "editorconfig"
if [ -x node_modules/.bin/editorconfig-checker ]; then
  if node_modules/.bin/editorconfig-checker; then ok editorconfig; else bad editorconfig; fi
elif command -v npx >/dev/null 2>&1; then
  if npx --yes editorconfig-checker; then ok editorconfig; else bad editorconfig; fi
else
  skip "editorconfig (node/npx not found - activate the conda env)"
fi

# 3. json manifests parse
section "json"
json_ok=1
for f in \
  .claude-plugin/marketplace.json \
  plugins/repo-review/.claude-plugin/plugin.json; do
  if python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$f"; then
    printf '  ok   %s\n' "$f"
  else
    printf '  bad  %s\n' "$f"; json_ok=0
  fi
done
[ "$json_ok" -eq 1 ] && ok json || bad json

# 4. workflow js syntax (ESM; checked via stdin so no package "type" needed)
section "workflow syntax"
if command -v node >/dev/null 2>&1; then
  syn=1
  for f in plugins/repo-review/workflows/*.js; do
    if node --check --input-type=module < "$f"; then
      printf '  ok   %s\n' "$f"
    else
      printf '  bad  %s\n' "$f"; syn=0
    fi
  done
  [ "$syn" -eq 1 ] && ok "workflow syntax" || bad "workflow syntax"
else
  skip "workflow syntax (node not found - activate the conda env)"
fi

# 5. workflow meta validity (required fields, pure literal, phase() matching)
section "meta"
if command -v node >/dev/null 2>&1; then
  if node scripts/checks/meta.mjs plugins/repo-review/workflows/*.js; then
    ok meta
  else
    bad meta
  fi
else
  skip "meta (node not found - activate the conda env)"
fi

# 5. plugin + marketplace manifest structure
section "plugin validate"
if command -v claude >/dev/null 2>&1; then
  if claude plugin validate . --strict < /dev/null; then
    ok "plugin validate"
  else
    bad "plugin validate"
  fi
else
  skip "plugin validate (claude CLI not found)"
fi

# 7. unit tests (node's built-in runner; skipped until tests exist)
section "tests"
if ! command -v node >/dev/null 2>&1; then
  skip "tests (node not found - activate the conda env)"
elif [ -n "$(find test -name '*.test.mjs' 2>/dev/null)" ]; then
  if node --test; then ok tests; else bad tests; fi
else
  skip "tests (none yet)"
fi

# summary
section "summary"
if [ "$fails" -eq 0 ]; then
  echo "all checks passed"
  exit 0
fi
echo "$fails check(s) failed"
exit 1

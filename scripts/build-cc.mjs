// generate the Claude Code workflow artifact (repo-review.js) from the authored
// modules (util + content + engine.mjs). the Claude Code runtime blocks
// import(), so the shipped file is self-contained: inline the three in
// dependency order, strip their imports and `export { }` blocks (keep
// `export const meta`, which the runtime extracts), and append a launcher
// wiring agent/log into the host. the .mjs files are the source of truth;
// repo-review.js is generated - do not hand-edit
//
// usage: node scripts/build-cc.mjs          # write the artifact
//        node scripts/build-cc.mjs --check   # verify it is up to date (CI)
import { readFileSync, writeFileSync } from 'node:fs'

const ROOT = new URL('../plugins/repo-review/lib/', import.meta.url)
const MODULES = ['util.mjs', 'content.mjs', 'engine.mjs'] // dependency order
const ARTIFACT = new URL('repo-review.js', ROOT)

const BANNER =
  '// generated from util/content/engine.mjs by scripts/build-cc.mjs\n' +
  '// do not edit by hand - edit the .mjs sources\n'

const LAUNCHER =
  '\n// Claude Code launcher: wire the runtime globals into the injected host.\n' +
  'const __host = {\n' +
  '  spawn: (prompt, opts) => agent(prompt, opts),\n' +
  '  log,\n' +
  '}\n' +
  'return run(__host, args)\n'

// strip a module down to inlinable source: drop intra-package import statements
// and `export { ... }` re-export blocks (single- or multi-line), while keeping
// `export const meta` (the runtime extracts it statically).
function strip(src) {
  return src
    .replace(/^import\b[\s\S]*?from\s*'\.[^']*'[^\n]*\n/gm, '')
    .replace(/^export\s*\{[\s\S]*?\}[^\n]*\n/gm, '')
}

function build() {
  const parts = MODULES.map(
    name => strip(readFileSync(new URL(name, ROOT), 'utf8')).trimEnd(),
  )
  return BANNER + parts.join('\n\n') + '\n' + LAUNCHER
}

const generated = build()

if (process.argv.includes('--check')) {
  let current = ''
  try {
    current = readFileSync(ARTIFACT, 'utf8')
  } catch {
    /* missing - treated as drift below */
  }
  if (current !== generated) {
    console.error(
      'build-cc: repo-review.js is stale - run `node scripts/build-cc.mjs`',
    )
    process.exit(1)
  }
  console.log('build-cc: artifact up to date')
} else {
  writeFileSync(ARTIFACT, generated)
  console.log('build-cc: wrote repo-review.js')
}

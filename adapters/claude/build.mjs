// generate the Claude Code workflow artifact (repo-review.js) from the authored
// modules (util + content + engine.mjs). the Claude Code runtime blocks
// import(), so the shipped file is self-contained: inline the three in
// dependency order, strip their imports and `export { }` blocks, hoist
// `export const meta` ahead of all code, and append a launcher wiring
// agent/log into the host. the .mjs files are the source of truth;
// repo-review.js is generated - do not hand-edit
//
// why hoist meta: the workflow runtime requires `export const meta` to be the
// FIRST STATEMENT of the script and rejects the whole file otherwise. meta is
// authored inside engine.mjs (where it belongs, beside the phases it names),
// but engine.mjs is inlined last, so in the concatenation it would sit behind
// util.mjs's and content.mjs's declarations. comments are not statements, so
// the banner may stay on top. scripts/checks/meta.mjs enforces the invariant
//
// usage: node adapters/claude/build.mjs          # write the artifact
//        node adapters/claude/build.mjs --check   # verify it is up to date (CI)
import { readFileSync, writeFileSync } from 'node:fs'

const SRC = new URL('../../src/', import.meta.url)
const MODULES = ['util.mjs', 'content.mjs', 'engine.mjs'] // dependency order
const ARTIFACT =
  new URL('../../plugins/repo-review/lib/repo-review.js', import.meta.url)

const BANNER =
  '// generated from util/content/engine.mjs by adapters/claude/build.mjs\n' +
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

// span of the `export const meta = { ... }` declaration in src, as [start, end)
// with end just past the closing brace. brace-scan, like scripts/checks/meta.mjs
// (meta is a pure literal by contract, so no strings can hide a brace).
function metaSpan(src) {
  const m = src.match(/^export\s+const\s+meta\s*=\s*\{/m)
  if (!m) throw new Error('build: no `export const meta = {...}` in the sources')
  const open = m.index + m[0].length - 1
  let depth = 0
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}' && --depth === 0) return [m.index, j + 1]
  }
  throw new Error('build: unterminated `export const meta` block')
}

// move the meta declaration to the front of the body, so it precedes every
// statement in the artifact (see the header note on why the runtime demands it)
function hoistMeta(body) {
  const [start, end] = metaSpan(body)
  const block = body.slice(start, end)
  const rest = (body.slice(0, start) + body.slice(end))
    .replace(/\n{3,}/g, '\n\n')
    .trimStart()
  return `${block}\n\n${rest}`
}

function build() {
  const parts = MODULES.map(
    name => strip(readFileSync(new URL(name, SRC), 'utf8')).trimEnd(),
  )
  return BANNER + hoistMeta(parts.join('\n\n')) + '\n' + LAUNCHER
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
      'build: repo-review.js is stale - run `node adapters/claude/build.mjs`',
    )
    process.exit(1)
  }
  console.log('build: artifact up to date')
} else {
  writeFileSync(ARTIFACT, generated)
  console.log('build: wrote repo-review.js')
}

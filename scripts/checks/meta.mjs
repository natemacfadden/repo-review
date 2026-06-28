// static validity check for workflow `meta` blocks. parses text - does NOT
// import (the module may throw at load) - and asserts:
//   - `export const meta = { ... }` exists
//   - meta has `name` and `description`
//   - no template-literal interpolation in the meta block (pure-ish literal)
//   - every phase('X') call has a matching meta.phases title
// usage: node scripts/checks/meta.mjs <workflow.js>...
// heuristic by design: regex/brace-scan, not a full parser
import { readFileSync } from 'node:fs'

let failed = false
const fail = (f, m) => { console.error(`  FAIL ${f}: ${m}`); failed = true }

function metaBlock(src) {
  const m = src.match(/export\s+const\s+meta\s*=\s*\{/)
  if (!m) return null
  const start = m.index + m[0].length - 1 // at the opening brace
  let depth = 0
  for (let j = start; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1)
  }
  return null
}

for (const file of process.argv.slice(2)) {
  const src = readFileSync(file, 'utf8')
  const block = metaBlock(src)
  if (!block) { fail(file, 'no `export const meta = {...}` found'); continue }

  if (!/\bname\s*:/.test(block)) fail(file, 'meta.name missing')
  if (!/\bdescription\s*:/.test(block)) fail(file, 'meta.description missing')
  if (/`/.test(block) || /\$\{/.test(block))
    fail(file, 'meta must be a pure literal (no template strings)')

  const declared = new Set(
    [...block.matchAll(/title\s*:\s*['"]([^'"]+)['"]/g)].map(x => x[1]),
  )
  const used = [...src.matchAll(/\bphase\(\s*['"]([^'"]+)['"]\s*\)/g)].map(x => x[1])
  for (const t of used)
    if (!declared.has(t))
      fail(file, `phase(${JSON.stringify(t)}) has no matching meta.phases title`)
}

if (failed) process.exit(1)
console.log('meta: valid')

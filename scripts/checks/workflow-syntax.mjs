// validate workflow scripts parse the way the runtime loads them: `meta` is
// statically extracted and the rest runs as an async function body, so
// top-level await and return are legal. we construct an AsyncFunction to parse
// (it does NOT execute the body), which mirrors the runtime and accepts those
// constructs that `node --check` would reject as a plain module.
// usage: node scripts/checks/workflow-syntax.mjs <workflow.js>...
import { readFileSync } from 'node:fs'

const AsyncFunction = async function () {}.constructor
let failed = false
for (const file of process.argv.slice(2)) {
  const src = readFileSync(file, 'utf8')
  // drop `export` so meta is a normal const inside the wrapped body
  const body = src.replace(/\bexport\s+const\s+meta\b/, 'const meta')
  try {
    AsyncFunction(body) // compiles/parses; never invoked
    console.log(`  ok   ${file}`)
  } catch (e) {
    console.error(`  bad  ${file}: ${e.message}`)
    failed = true
  }
}
if (failed) process.exit(1)
console.log('workflow syntax: ok')

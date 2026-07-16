// Generate the Claude Code workflow artifact (lib/repo-review.js) from the
// authored engine (lib/engine.mjs). The CC Workflow runtime blocks import(),
// so the shipped file must be self-contained: we inline the engine, drop the
// `run` export, and append a launcher that wires the runtime globals
// (agent/log) into the injected host. engine.mjs stays the single source of
// truth; repo-review.js is generated - do not edit it by hand.
//
// usage: node scripts/build-cc.mjs          # write the artifact
//        node scripts/build-cc.mjs --check   # verify it is up to date (CI)
import { readFileSync, writeFileSync } from 'node:fs'

const ROOT = new URL('../plugins/repo-review/lib/', import.meta.url)
const ENGINE = new URL('engine.mjs', ROOT)
const ARTIFACT = new URL('repo-review.js', ROOT)

const BANNER =
  '// Generated from engine.mjs by scripts/build-cc.mjs - edit engine.mjs.\n'

const LAUNCHER =
  '\n// Claude Code launcher: wire the runtime globals into the injected host.\n' +
  'const __host = {\n' +
  '  spawn: (prompt, opts) => agent(prompt, opts),\n' +
  '  log,\n' +
  '}\n' +
  'return run(__host, args)\n'

function build() {
  const engine = readFileSync(ENGINE, 'utf8')
  // drop only the `run` export; `export const meta` must stay for the runtime
  // to statically extract it.
  const inlined = engine.replace(
    /export async function run\(/,
    'async function run(',
  )
  return BANNER + inlined + LAUNCHER
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

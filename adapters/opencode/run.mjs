#!/usr/bin/env node
// opencode host for the repo-review engine. Same engine as Claude Code
// (src/engine.mjs); only the host differs. host.spawn runs a headless
// `opencode run` session per lens and validates its JSON; host.log prints to
// stdout; reasoning is saved per session when the model emits it.
//
//   node adapters/opencode/run.mjs <repo>[:flavor]... [--profile ..] [--for ..]
//   REPO_REVIEW_MODEL=provider/model   (default: opencode's own default)
import { spawn, spawnSync } from 'node:child_process'
import {
  mkdirSync, writeFileSync, readFileSync, statSync,
  existsSync, copyFileSync, rmSync,
} from 'node:fs'
import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { run } from '../../src/engine.mjs'
import { repoSlug } from '../../src/util.mjs'
import {
  extractText, extractReasoning, extractUsage, extractJson, validate,
  schemaInstruction,
} from './parse.mjs'

const MODEL = process.env.REPO_REVIEW_MODEL || null
const MAX_TRIES = Number(process.env.REPO_REVIEW_TRIES || 3)
let outBase = `${process.cwd()}/repo-review-out`
let runStamp = null
const metrics = []
// raw stream fallback: each spawn's raw is spilled to scratch (off outBase,
// out of the model's reach); a unit's raw is promoted into the archive only
// if its doc came out missing/empty. REVIEW_KEEP_RAW=1 keeps every stream
const KEEP_RAW = process.env.REVIEW_KEEP_RAW === '1'
let rawDir = null
const docPaths = new Map()   // label -> the doc path the unit declared
const safeName = (s) => String(s || 'spawn').replace(/[^\w.-]+/g, '_')

function opencodeRun(prompt) {
  return new Promise((resolve, reject) => {
    const args = ['run', '--format', 'json', '--auto']
    if (MODEL) args.push('-m', MODEL)
    args.push(prompt)
    const child = spawn('opencode', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { err += d })
    child.on('error', reject)
    child.on('close', code => code === 0
      ? resolve(out)
      : reject(new Error(`opencode run exited ${code}: ` +
          `${(err.trim() || out).slice(-600)}`)))
  })
}

function saveReasoning(label, text) {
  if (!text) return
  const dir = `${outBase}/reasoning`
  mkdirSync(dir, { recursive: true })
  const file = `${dir}/${safeName(label)}.md`
  writeFileSync(file, text)
  console.log(`  reasoning -> ${file}`)
}

const host = {
  log: (msg) => console.log(msg),
  async spawn(prompt, opts) {
    const schema = opts && opts.schema
    const full = schema ? prompt + schemaInstruction(schema) : prompt
    const t0 = Date.now()
    const usage = {
      input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0,
      total: 0, cost: 0,
    }
    let result = null
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      let raw
      try {
        raw = await opencodeRun(full)
      } catch (e) {
        // hard opencode error - fail this lens (spawn returns null), don't retry
        console.log(`  ${opts && opts.label} - opencode error, failing lens: ` +
          `${String((e && e.message) || e).slice(-140)}`)
        break
      }
      spillRaw(opts && opts.label, raw)
      const u = extractUsage(raw)
      for (const k of Object.keys(usage)) usage[k] += u[k]
      saveReasoning(opts && opts.label, extractReasoning(raw))
      const text = extractText(raw)
      if (!schema) { result = text; break }
      const obj = extractJson(text)
      if (validate(obj, schema)) {
        const dp = obj.reviewPath || obj.memoPath
        if (dp) docPaths.set(opts && opts.label, dp)
        result = obj
        break
      }
      console.log(`  retry ${attempt}/${MAX_TRIES}: ${opts.label} - no valid JSON`)
    }
    metrics.push({
      label: (opts && opts.label) || 'spawn',
      phase: (opts && opts.phase) || null,
      seconds: Math.round((Date.now() - t0) / 1000),
      tokens: usage,
    })
    return result
  },
}

// stand in for the Claude Code command: supply --out/--stamp/--date if absent.
// pure - given the args, the current time (ISO string), and the default out
// base, it returns the augmented args plus the resolved out base and stamp; the
// caller records those.
function doorman(argstr, nowIso, defaultOutBase) {
  const auto = nowIso.replace(/[-:]/g, '').replace(/\.\d+/, '') // 20260716T030452Z
  const date = nowIso.slice(0, 10) // 2026-07-16
  const m = argstr.match(/--out(?:=|\s+)("[^"]*"|\S+)/)
  const base = m ? m[1].replace(/^"|"$/g, '') : defaultOutBase
  const sm = argstr.match(/--stamp(?:=|\s+)("[^"]*"|\S+)/)
  const stamp = sm ? sm[1].replace(/^"|"$/g, '') : auto
  let a = argstr
  if (!m) a += ` --out "${base}"`
  if (!sm) a += ` --stamp ${stamp}`
  if (!/--date(\s|=)/.test(a)) a += ` --date ${date}`
  return { args: a, outBase: base, stamp }
}

// recover the repo path from a spawn label (review:<path>:<lens>, else X:<path>).
function repoPathFromLabel(label) {
  const parts = String(label).split(':')
  return parts[0] === 'review' ? parts.slice(1, -1).join(':') : parts.slice(1).join(':')
}

// size of the committed code, so cost can later be modeled against it. counts
// git-tracked files; lines/bytes over text files (binaries and >1 MB skipped).
function repoSize(path) {
  const r = spawnSync('git', ['-C', path, 'ls-files'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) return null
  const files = r.stdout.split('\n').filter(Boolean)
  let lines = 0
  let bytes = 0
  let counted = 0
  for (const f of files) {
    try {
      const st = statSync(`${path}/${f}`)
      if (!st.isFile()) continue
      bytes += st.size
      if (st.size > 1_000_000) continue
      const buf = readFileSync(`${path}/${f}`)
      if (buf.includes(0)) continue // binary
      lines += buf.toString('utf8').split('\n').length
      counted++
    } catch { /* unreadable - skip */ }
  }
  return { files: files.length, textFiles: counted, lines, bytes }
}

// write per-repo metrics.json (per-lens + totals) into each review dir.
function writeMetrics() {
  const byRepo = new Map()
  for (const m of metrics) {
    const path = repoPathFromLabel(m.label)
    if (!path) continue
    if (!byRepo.has(path)) byRepo.set(path, [])
    byRepo.get(path).push(m)
  }
  for (const [path, lenses] of byRepo) {
    const totals = { seconds: 0, tokens: {} }
    for (const e of lenses) {
      totals.seconds += e.seconds
      for (const k of Object.keys(e.tokens)) {
        totals.tokens[k] = (totals.tokens[k] || 0) + e.tokens[k]
      }
    }
    const dir = `${outBase}/${repoSlug(path)}/${runStamp}`
    mkdirSync(dir, { recursive: true })
    const payload = {
      repo: path, model: MODEL, stamp: runStamp,
      size: repoSize(path), totals, lenses,
    }
    writeFileSync(`${dir}/metrics.json`, JSON.stringify(payload, null, 2))
    console.log(`metrics -> ${dir}/metrics.json ` +
      `(${totals.tokens.total || 0} tok, ${totals.seconds}s)`)
  }
}

// spill one spawn's raw stream to scratch so we can keep it if the doc fails.
// on disk, not in memory - holding every stream would risk the mem watchdog
function spillRaw(label, raw) {
  if (!rawDir) return
  try {
    mkdirSync(rawDir, { recursive: true })
    writeFileSync(join(rawDir, safeName(label) + '.raw.jsonl'), raw)
  } catch { /* best effort - the review still returns */ }
}

// the runner's fallback: for each unit whose doc is missing/empty, promote its
// raw stream into the archive as the best output we have. turning a stream back
// into a clean doc is a separate offline tool (resurrect.mjs), never the
// runner's job. keepAll promotes every declared unit (REVIEW_KEEP_RAW)
function saveRaw(docs, dir, keepAll) {
  const MIN_DOC = 200  // a real review doc is always larger than this
  let saved = 0
  for (const [label, docPath] of docs) {
    const spill = join(dir, safeName(label) + '.raw.jsonl')
    if (!existsSync(spill)) continue
    let ok = false
    try { ok = statSync(docPath).size >= MIN_DOC } catch { ok = false }
    if (ok && !keepAll) continue
    const dest = docPath.replace(/\.md$/, '') + '.raw.jsonl'
    try {
      mkdirSync(dirname(dest), { recursive: true })
      copyFileSync(spill, dest)
      saved++
      console.log(ok
        ? `  keeping raw (REVIEW_KEEP_RAW) -> ${dest}`
        : `  doc missing/empty for ${label} - saved raw -> ${dest}`)
    } catch (e) {
      console.log(`  could not save raw for ${label}: ${e.message}`)
    }
  }
  if (saved) console.log(`saved ${saved} raw stream(s) as fallback records`)
  return saved
}

// re-quote argv tokens with spaces so a multi-word value (e.g. --for "a b c")
// survives being rejoined and re-tokenized by the engine.
function quoteArgs(argv) {
  return argv.map(a => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')
}

export { doorman, quoteArgs, repoPathFromLabel, saveRaw }

// only run a review when invoked directly (not when imported by a test).
if (import.meta.url === pathToFileURL(process.argv[1] || '.').href) {
  const d = doorman(quoteArgs(process.argv.slice(2)), new Date().toISOString(), outBase)
  outBase = d.outBase
  runStamp = d.stamp
  rawDir = join(tmpdir(), `rr-raw-${runStamp}`)
  const result = await run(host, d.args)
  saveRaw(docPaths, rawDir, KEEP_RAW)
  rmSync(rawDir, { recursive: true, force: true })
  writeMetrics()
  console.log('\n' + JSON.stringify(result, null, 2))
}

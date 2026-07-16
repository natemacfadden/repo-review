#!/usr/bin/env node
// opencode host for the repo-review engine. Same engine as Claude Code
// (lib/engine.mjs); only the host differs. host.spawn runs a headless
// `opencode run` session per lens and validates its JSON; host.log prints to
// stdout; reasoning is saved per session when the model emits it.
//
//   node adapters/opencode/run.mjs <repo>[:flavor]... [--profile ..] [--for ..]
//   REPO_REVIEW_MODEL=provider/model   (default: opencode's own default)
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { run } from '../../plugins/repo-review/lib/engine.mjs'
import {
  extractText, extractReasoning, extractJson, validate, schemaInstruction,
} from './parse.mjs'

const MODEL = process.env.REPO_REVIEW_MODEL || null
const MAX_TRIES = Number(process.env.REPO_REVIEW_TRIES || 3)
let outBase = `${process.cwd()}/repo-review-out`

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
      : reject(new Error(`opencode run exited ${code}: ${err.slice(-400)}`)))
  })
}

function saveReasoning(label, text) {
  if (!text) return
  const dir = `${outBase}/reasoning`
  mkdirSync(dir, { recursive: true })
  const file = `${dir}/${String(label || 'spawn').replace(/[^\w.-]+/g, '_')}.md`
  writeFileSync(file, text)
  console.log(`  reasoning -> ${file}`)
}

const host = {
  log: (msg) => console.log(msg),
  async spawn(prompt, opts) {
    const schema = opts && opts.schema
    const full = schema ? prompt + schemaInstruction(schema) : prompt
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      const raw = await opencodeRun(full)
      saveReasoning(opts && opts.label, extractReasoning(raw))
      const text = extractText(raw)
      if (!schema) return text
      const obj = extractJson(text)
      if (validate(obj, schema)) return obj
      console.log(`  retry ${attempt}/${MAX_TRIES}: ${opts.label} - no valid JSON`)
    }
    return null
  },
}

// Stand in for the Claude Code command: supply --out/--stamp/--date if absent.
function doorman(argstr) {
  const iso = new Date().toISOString() // 2026-07-16T03:04:52.123Z
  const stamp = iso.replace(/[-:]/g, '').replace(/\.\d+/, '') // 20260716T030452Z
  const date = iso.slice(0, 10) // 2026-07-16
  const m = argstr.match(/--out(?:=|\s+)("[^"]*"|\S+)/)
  if (m) outBase = m[1].replace(/^"|"$/g, '')
  let a = argstr
  if (!m) a += ` --out "${outBase}"`
  if (!/--stamp(\s|=)/.test(a)) a += ` --stamp ${stamp}`
  if (!/--date(\s|=)/.test(a)) a += ` --date ${date}`
  return a
}

const result = await run(host, doorman(process.argv.slice(2).join(' ')))
console.log('\n' + JSON.stringify(result, null, 2))

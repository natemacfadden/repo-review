#!/usr/bin/env node
// peek - trust-free live view of a repo-review workflow run.
//
// renders each worker's recent activity from the HARNESS-written transcripts
// (.../subagents/workflows/<run-id>/agent-*.jsonl). the harness appends every
// tool call the moment it is made, so this view cannot be skipped, delayed,
// or faked by the model. worker identity comes from each transcript's
// opening prompt, which the deterministic engine authored, so the labels
// are trust-free too. this is the run's ONLY status channel by design:
// model-written progress files were tried and removed after workers
// skipped them or fabricated their timestamps.
//
// usage: node peek.mjs [run-dir] [-n <calls>]
//   run-dir  a .../subagents/workflows/<run-id> dir; defaults to the run with
//            the most recent activity across every project under
//            $CLAUDE_CONFIG_DIR (default ~/.claude)
//   -n       tool calls shown per worker (default 5)

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

function parseArgv(argv) {
  let dir = null
  let n = 5
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '-n') n = Math.max(1, parseInt(argv[++i], 10) || 5)
    else dir = argv[i]
  }
  return { dir, n }
}

// list a directory's entry names, [] if unreadable
function ls(dir) {
  try { return readdirSync(dir) } catch { return [] }
}

// every workflow run dir under <cfg>/projects/*/*/subagents/workflows/*
function findRuns(cfg) {
  const runs = []
  const projects = join(cfg, 'projects')
  for (const p of ls(projects)) {
    for (const s of ls(join(projects, p))) {
      const wf = join(projects, p, s, 'subagents', 'workflows')
      for (const r of ls(wf)) runs.push(join(wf, r))
    }
  }
  return runs
}

// newest mtime among a run's agent transcripts (0 if none yet)
function lastActivity(run) {
  let t = 0
  for (const f of ls(run)) {
    if (!/^agent-.*\.jsonl$/.test(f)) continue
    try { t = Math.max(t, statSync(join(run, f)).mtimeMs) } catch {}
  }
  return t
}

// journal.jsonl is engine-written: "started" lines give trustworthy spawn
// order, and any later line for the same agentId marks it finished. the
// `key` on a started line identifies the agent() call it serves - two
// starts sharing a key are the engine RETRYING one call after a stall,
// not two different workers.
function readJournal(run) {
  const started = []
  const ended = new Map()
  let text = ''
  try { text = readFileSync(join(run, 'journal.jsonl'), 'utf8') } catch {}
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let e
    try { e = JSON.parse(line) } catch { continue }
    if (!e.agentId) continue
    if (e.type === 'started') started.push({ id: e.agentId, key: e.key || '' })
    else ended.set(e.agentId, e.type || 'ended')
  }
  return { started, ended }
}

// pull the opening prompt and every tool call out of one agent transcript.
// entries hold {timestamp, message: {role, content}}; content is a string or
// an array of typed blocks.
function readAgent(path) {
  let text = ''
  try { text = readFileSync(path, 'utf8') } catch {}
  let prompt = ''
  const calls = []
  let last = ''
  let killed = false
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let e
    try { e = JSON.parse(line) } catch { continue }
    if (e.timestamp) last = e.timestamp
    const msg = e.message
    if (!msg) continue
    const content = msg.content
    const bodyText = typeof content === 'string'
      ? content
      : (Array.isArray(content) ? content : [])
          .filter(c => c && c.type === 'text').map(c => c.text).join('\n')
    if (!prompt && msg.role === 'user') prompt = bodyText
    // an interrupt (stall watchdog or a manual esc) lands as a final
    // user-role "[Request interrupted..." message; only the LAST entry
    // counts, so this flag is re-cleared by any later activity
    killed = msg.role === 'user' && /\[Request interrupted/.test(bodyText)
    for (const c of Array.isArray(content) ? content : []) {
      if (c && c.type === 'tool_use') {
        calls.push({ ts: e.timestamp || '', name: c.name, input: c.input })
      }
    }
  }
  return { prompt, calls, last, killed }
}

// name a worker from its engine-authored prompt (see reviewPrompt/
// detectPrompt/synthesisPrompt in lib/repo-review.js); fall back to the
// prompt's first line for agents this plugin didn't spawn.
function label(prompt) {
  const lens = /YOUR LENS[^:]*:\s*([^.\n]+)/.exec(prompt)
  if (lens) return `review: ${lens[1].trim()}`
  if (/classifying the INTENT/.test(prompt)) return 'detect'
  if (/synthesizing chair/.test(prompt)) return 'synthesis'
  const head = (prompt.split('\n')[0] || '').slice(0, 60).trim()
  return head || '(no prompt recorded)'
}

// one-line rendering of a tool call's input
function condense(input) {
  if (!input || typeof input !== 'object') return ''
  const s = input.command || input.file_path || input.prompt ||
    input.description || JSON.stringify(input)
  return String(s).split('\n').map(x => x.trim()).filter(Boolean)
    .join(' ; ').slice(0, 64)
}

function age(iso) {
  if (!iso) return 'no activity'
  const ms = Date.now() - Date.parse(iso)
  if (!(ms >= 0)) return iso
  const m = Math.floor(ms / 60000)
  if (m < 1) return `${Math.floor(ms / 1000)}s ago`
  if (m < 60) return `${m}m ${Math.floor((ms % 60000) / 1000)}s ago`
  return `${Math.floor(m / 60)}h ${m % 60}m ago`
}

const { dir, n } = parseArgv(process.argv.slice(2))
let run = dir
if (!run) {
  const cfg = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  const runs = findRuns(cfg)
    .map(r => ({ r, t: lastActivity(r) })).filter(x => x.t > 0)
    .sort((a, b) => b.t - a.t)
  if (!runs.length) {
    console.error(`no workflow runs found under ${cfg}/projects`)
    process.exit(1)
  }
  run = runs[0].r
  console.log(`run: ${run}`)
  console.log(`     (most recent of ${runs.length}; pass a run dir to pick)`)
} else {
  console.log(`run: ${run}`)
}

const { started, ended } = readJournal(run)
const order = started.map(s => s.id)
const onDisk = ls(run)
  .filter(f => /^agent-.*\.jsonl$/.test(f))
  .map(f => f.replace(/^agent-|\.jsonl$/g, ''))
// journal order first (engine truth), then any transcript the journal missed
const ids = [...order, ...onDisk.filter(id => !order.includes(id))]

// group started entries by call key to expose retries: attempt counts make
// a stall-retry loop read as "one call, N attempts", never as N workers
const byKey = new Map()
for (const s of started) {
  if (!byKey.has(s.key)) byKey.set(s.key, [])
  byKey.get(s.key).push(s.id)
}
const attempt = new Map()
for (const group of byKey.values()) {
  if (group.length < 2) continue
  group.forEach((id, i) => attempt.set(id, { n: i + 1, of: group.length }))
}

if (!ids.length) console.log('no agents spawned yet')
for (let i = 0; i < ids.length; i++) {
  const id = ids[i]
  const a = readAgent(join(run, `agent-${id}.jsonl`))
  const state = ended.has(id) ? ended.get(id)
    : a.killed ? 'KILLED - "[Request interrupted]" (stall watchdog or esc)'
    : 'RUNNING'
  const r = attempt.get(id)
  const tag = r ? ` - attempt ${r.n}/${r.of} of the SAME agent() call` : ''
  console.log(`\n[${i + 1}] ${label(a.prompt)}${tag}`)
  console.log(`    ${state} - last activity ${age(a.last)} - ` +
    `${a.calls.length} tool calls`)
  for (const c of a.calls.slice(-n)) {
    const hms = (/T(\d\d:\d\d:\d\d)/.exec(c.ts) || [, '--:--:--'])[1]
    console.log(`    ${hms}Z  ${c.name.padEnd(6)} ${condense(c.input)}`)
  }
}

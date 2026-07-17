#!/usr/bin/env node
// offline reconstruction tool - NOT part of the runner. turns a saved raw
// opencode stream (<unit>.raw.jsonl, the runner's fallback when a doc came out
// missing/empty) back into the review markdown the model wrote. being wrong
// here never loses data - the raw bytes are already on disk, so this can be
// fixed and re-run at will.
//   node adapters/opencode/resurrect.mjs <raw.jsonl> [outPath]
// with no outPath it prints the recovered doc to stdout
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// every write tool call in the stream as {filePath, content}, in order
export function extractWrites(jsonl) {
  const out = []
  for (const line of String(jsonl || '').split('\n')) {
    if (!line.trim()) continue
    let ev
    try {
      ev = JSON.parse(line)
    } catch {
      continue
    }
    const p = ev && ev.part
    if (!p || p.type !== 'tool' || p.tool !== 'write') continue
    const inp = (p.state && p.state.input) || {}
    if (inp.filePath && typeof inp.content === 'string') {
      out.push({ filePath: inp.filePath, content: inp.content })
    }
  }
  return out
}

// the recovered review doc: the model's last write to a .md file (else its
// last write of any kind), null if the stream wrote nothing
export function recoverDoc(jsonl) {
  const writes = extractWrites(jsonl)
  const md = writes.filter(w => w.filePath.endsWith('.md'))
  const pick = (md.length ? md : writes).at(-1)
  return pick ? pick.content : null
}

if (import.meta.url === pathToFileURL(process.argv[1] || '.').href) {
  const [rawPath, outPath] = process.argv.slice(2)
  if (!rawPath) {
    console.error('usage: node resurrect.mjs <raw.jsonl> [outPath]')
    process.exit(1)
  }
  const doc = recoverDoc(readFileSync(rawPath, 'utf8'))
  if (doc == null) {
    console.error(`no doc write found in ${rawPath}`)
    process.exit(2)
  }
  if (outPath) {
    writeFileSync(outPath, doc)
    console.log(`recovered ${doc.length} chars -> ${outPath}`)
  } else {
    process.stdout.write(doc)
  }
}

// turn an `opencode run --format json` event stream into the pieces the
// adapter needs: assistant text, a structured object, and any reasoning.

function partsOfType(jsonl, type) {
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
    if (p && p.type === type && typeof p.text === 'string') out.push(p.text)
  }
  return out
}

export const extractText = (jsonl) => partsOfType(jsonl, 'text').join('')

// reasoning parts, when the model/provider emits them (many do not).
export const extractReasoning = (jsonl) =>
  partsOfType(jsonl, 'reasoning').join('\n')

// sum token usage and cost across the stream's step-finish events.
export function extractUsage(jsonl) {
  const u = {
    input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0,
    total: 0, cost: 0,
  }
  for (const line of String(jsonl || '').split('\n')) {
    if (!line.trim()) continue
    let ev
    try {
      ev = JSON.parse(line)
    } catch {
      continue
    }
    const p = ev && ev.part
    if (!p || p.type !== 'step-finish') continue
    const t = p.tokens || {}
    u.input += t.input || 0
    u.output += t.output || 0
    u.reasoning += t.reasoning || 0
    u.total += t.total || 0
    if (t.cache) {
      u.cacheRead += t.cache.read || 0
      u.cacheWrite += t.cache.write || 0
    }
    u.cost += p.cost || 0
  }
  return u
}

// the last valid ```json fence, else the last {...} span, else null.
export function extractJson(text) {
  const s = String(text || '')
  let cands = [...s.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map(m => m[1])
  if (!cands.length) {
    const a = s.indexOf('{')
    const b = s.lastIndexOf('}')
    cands = a >= 0 && b > a ? [s.slice(a, b + 1)] : []
  }
  for (let i = cands.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(cands[i])
    } catch {
      // try an earlier candidate
    }
  }
  return null
}

export function validate(obj, schema) {
  if (!obj || typeof obj !== 'object') return false
  return ((schema && schema.required) || []).every(k => k in obj)
}

// opencode does not force schemas, so ask the model for one.
export const schemaInstruction = (schema) =>
  '\n\nEnd your reply with a single fenced ```json block (nothing after it) ' +
  'matching this schema:\n' + JSON.stringify(schema)

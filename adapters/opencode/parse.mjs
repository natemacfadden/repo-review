// Turn an `opencode run --format json` event stream into the pieces the
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

// Reasoning parts, when the model/provider emits them (many do not).
export const extractReasoning = (jsonl) =>
  partsOfType(jsonl, 'reasoning').join('\n')

// The last valid ```json fence, else the last {...} span, else null.
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

import { readFileSync } from 'node:fs'

// workflow scripts can't be imported (top-level return / export meta, and the
// runtime blocks import()), so we lift the marked pure region out of the file
// and evaluate it to expose those functions to tests. single source of truth
// stays the shipped workflow.
export function loadPure(workflowPath, names) {
  const src = readFileSync(workflowPath, 'utf8')
  const m = src.match(/\/\/ >>> pure[^\n]*\n([\s\S]*?)\n\/\/ <<< pure/)
  if (!m) throw new Error(`pure region not found in ${workflowPath}`)
  return new Function(`${m[1]}\nreturn { ${names.join(', ')} }`)()
}

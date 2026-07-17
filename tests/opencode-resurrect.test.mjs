import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractWrites, recoverDoc } from '../adapters/opencode/resurrect.mjs'

// a raw opencode stream (JSONL) where the model wrote a probe, then the review
const STREAM = [
  '{"part":{"type":"text","text":"planning"}}',
  '{"part":{"type":"tool","tool":"read","state":{"input":' +
    '{"filePath":"/r/README.md"}}}}',
  '{"part":{"type":"tool","tool":"write","state":{"input":' +
    '{"filePath":"/tmp/probe.mjs","content":"console.log(1)"}}}}',
  '{"part":{"type":"tool","tool":"write","state":{"input":' +
    '{"filePath":"/out/perf.md","content":"# draft"}}}}',
  '{"part":{"type":"tool","tool":"write","state":{"input":' +
    '{"filePath":"/out/perf.md","content":"# final review"}}}}',
  '{"part":{"type":"tool","tool":"write","state":{"input":' +
    '{"filePath":"/out/x.md"}}}}',
].join('\n')

test('extractWrites: all writes with content, in order; ignores the rest', () => {
  const w = extractWrites(STREAM)
  // read parts and the content-less write are ignored; order preserved
  assert.deepEqual(w.map(x => x.filePath),
    ['/tmp/probe.mjs', '/out/perf.md', '/out/perf.md'])
  assert.equal(w.at(-1).content, '# final review')
})

test('recoverDoc: returns the last .md write (the review doc), not a probe', () => {
  assert.equal(recoverDoc(STREAM), '# final review')
})

test('recoverDoc: null when the stream wrote nothing', () => {
  assert.equal(recoverDoc('{"part":{"type":"text","text":"no writes"}}'), null)
  assert.equal(recoverDoc(''), null)
})

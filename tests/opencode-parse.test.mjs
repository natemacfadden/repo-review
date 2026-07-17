import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractText, extractReasoning, extractUsage, extractJson, validate,
  schemaInstruction,
} from '../adapters/opencode/parse.mjs'

// a representative `opencode run --format json` stream (JSONL)
const STREAM = [
  '{"type":"step_start","part":{"type":"step-start"}}',
  '{"type":"reasoning","part":{"type":"reasoning","text":"Let me think."}}',
  '{"type":"text","part":{"type":"text","text":"Working on it. "}}',
  '{"type":"tool","part":{"type":"tool","tool":"bash"}}',
  '{"type":"text","part":{"type":"text","text":"Done.\\n```json\\n' +
    '{\\"flavor\\":\\"research\\"}\\n```"}}',
  '{"type":"step_finish","part":{"type":"step-finish","tokens":{"total":10}}}',
  'not json - a stray log line',
].join('\n')

test('extractText: concatenates text parts in order, ignores non-text/non-json', () => {
  const t = extractText(STREAM)
  assert.match(t, /^Working on it\. Done\./)
  assert.doesNotMatch(t, /step-start|bash/)
})

test('extractReasoning: collects reasoning parts; text excludes them', () => {
  assert.equal(extractReasoning(STREAM), 'Let me think.')
  assert.doesNotMatch(extractText(STREAM), /Let me think/)
})

test('extractUsage: sums tokens and cost across step-finish events', () => {
  const s = [
    '{"part":{"type":"step-finish","tokens":{"total":10,"input":8,' +
      '"output":2},"cost":0.01}}',
    '{"part":{"type":"step-finish","tokens":{"total":5,"input":4,"output":1,' +
      '"cache":{"read":3,"write":1}},"cost":0.02}}',
  ].join('\n')
  const u = extractUsage(s)
  assert.equal(u.total, 15)
  assert.equal(u.input, 12)
  assert.equal(u.cacheRead, 3)
  assert.equal(Math.round(u.cost * 100), 3)
})

test('extractJson: pulls the fenced json block', () => {
  const obj = extractJson(extractText(STREAM))
  assert.deepEqual(obj, { flavor: 'research' })
})

test('extractJson: prefers the LAST valid fence', () => {
  const text = '```json\n{"a":1}\n```\nmore\n```json\n{"a":2}\n```'
  assert.deepEqual(extractJson(text), { a: 2 })
})

test('extractJson: falls back to a bare {...} span', () => {
  assert.deepEqual(extractJson('blah {"x": 5} trailing'), { x: 5 })
})

test('extractJson: returns null when nothing parses', () => {
  assert.equal(extractJson('no json here'), null)
  assert.equal(extractJson(''), null)
})

test('validate: requires object with all schema-required keys', () => {
  const schema = { required: ['flavor'] }
  assert.equal(validate({ flavor: 'x' }, schema), true)
  assert.equal(validate({ other: 1 }, schema), false)
  assert.equal(validate(null, schema), false)
  assert.equal(validate({ anything: 1 }, {}), true) // no required -> ok
})

test('schemaInstruction: embeds the schema and asks for a json fence', () => {
  const ins = schemaInstruction({ required: ['flavor'] })
  assert.match(ins, /```json/)
  assert.match(ins, /"required":\["flavor"\]/)
})

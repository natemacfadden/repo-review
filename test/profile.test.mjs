import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPure } from './extract.mjs'

const WF = 'plugins/repo-review/workflows/repo-review.js'
const { resolveProfile } = loadPure(WF, ['resolveProfile'])

test('resolveProfile: null/empty -> general default', () => {
  assert.equal(resolveProfile(null).name, 'general')
  assert.equal(resolveProfile('').name, 'general')
  assert.equal(resolveProfile(undefined).name, 'general')
})

test('resolveProfile: each v1 profile resolves with a verdict scale', () => {
  for (const name of ['general', 'job', 'oss-audit', 'student-project']) {
    const p = resolveProfile(name)
    assert.equal(p.name, name)
    assert.ok(Array.isArray(p.verdicts) && p.verdicts.length > 0)
  }
})

test('resolveProfile: every profile carries framing fields', () => {
  for (const name of ['general', 'job', 'oss-audit', 'student-project']) {
    const p = resolveProfile(name)
    for (const field of ['label', 'audience', 'bar', 'purpose']) {
      assert.equal(typeof p[field], 'string')
      assert.ok(p[field].length > 0, `${name}.${field} should be non-empty`)
    }
  }
})

test('resolveProfile: job verdict scale', () => {
  assert.deepEqual(resolveProfile('job').verdicts, [
    'Strong Hire',
    'Hire',
    'Lean Hire',
    'Lean No-Hire',
    'No-Hire',
  ])
})

test('resolveProfile: --for specialization is woven into the framing', () => {
  const base = resolveProfile('job')
  const spec = resolveProfile('job', 'a RE role at Anthropic')
  assert.equal(spec.specialization, 'a RE role at Anthropic')
  assert.match(spec.audience, /a RE role at Anthropic/)
  assert.match(spec.purpose, /a RE role at Anthropic/)
  // base (no specialization) is unchanged and carries no field
  assert.equal(base.specialization, undefined)
})

test('resolveProfile: unknown throws and lists valid names', () => {
  assert.throws(() => resolveProfile('frontier'), /unknown profile/)
  assert.throws(() => resolveProfile('frontier'), /general.*job/s)
})

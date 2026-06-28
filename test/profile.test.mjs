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

test('resolveProfile: job verdict scale', () => {
  assert.deepEqual(resolveProfile('job').verdicts, [
    'Strong Hire',
    'Hire',
    'Lean Hire',
    'Lean No-Hire',
    'No-Hire',
  ])
})

test('resolveProfile: unknown throws and lists valid names', () => {
  assert.throws(() => resolveProfile('frontier'), /unknown profile/)
  assert.throws(() => resolveProfile('frontier'), /general.*job/s)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPure } from './extract.mjs'

const WF = 'plugins/repo-review/workflows/repo-review.js'
const { reconcileScores } = loadPure(WF, ['reconcileScores'])

const reviews = [
  {
    lens: 'performance',
    scores: { performance: 10, correctness: 6, honesty: 4, overall: 8 },
  },
  {
    lens: 'correctness',
    scores: { performance: 4, correctness: 9, honesty: 8, overall: 6 },
  },
]

test('reconcile: lens-owned axis weights the specialist (2x)', () => {
  // performance owned by lens 'performance': (10*2 + 4*1)/3 = 8.0
  // (plain mean would be 7) - confirms weighting actually applies
  assert.equal(reconcileScores(reviews).reconciled.performance, 8)
  // correctness owned by lens 'correctness': (6*1 + 9*2)/3 = 8.0
  assert.equal(reconcileScores(reviews).reconciled.correctness, 8)
})

test('reconcile: unowned axes use a plain mean', () => {
  const r = reconcileScores(reviews).reconciled
  assert.equal(r.honesty, 6) // (4+8)/2
  assert.equal(r.overall, 7) // (8+6)/2
})

test('reconcile: reports min-max range per axis', () => {
  assert.deepEqual(reconcileScores(reviews).ranges.performance, {
    min: 4,
    max: 10,
  })
})

test('reconcile: axis with no scores -> null', () => {
  const out = reconcileScores(reviews)
  assert.equal(out.reconciled.engineering, null)
  assert.equal(out.ranges.engineering, null)
})

test('reconcile: empty/garbage input -> all axes null', () => {
  for (const bad of [[], null, undefined]) {
    const out = reconcileScores(bad)
    assert.equal(out.reconciled.overall, null)
    assert.equal(out.ranges.performance, null)
  }
})

test('reconcile: non-number scores are skipped; mean rounds to 0.1', () => {
  const rs = [
    { lens: 'docs', scores: { overall: 1 } },
    { lens: 'docs', scores: { overall: 2 } },
    { lens: 'docs', scores: { overall: 2 } },
    { lens: 'docs', scores: { overall: 'oops' } },
  ]
  // (1+2+2)/3 = 1.666... -> 1.7; the string is ignored
  assert.equal(reconcileScores(rs).reconciled.overall, 1.7)
})

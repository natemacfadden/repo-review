import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPure } from './extract.mjs'

const WF = 'plugins/repo-review/lib/repo-review.js'
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

test('reconcile: out-of-range scores are clamped into [1,10]', () => {
  const rs = [
    { lens: 'documentation', scores: { overall: 100 } },
    { lens: 'documentation', scores: { overall: -5 } },
  ]
  // clamp -> (10 + 1)/2 = 5.5; the range reflects the clamped values
  assert.equal(reconcileScores(rs).reconciled.overall, 5.5)
  assert.deepEqual(reconcileScores(rs).ranges.overall, { min: 1, max: 10 })
})

test('reconcile: non-finite scores (Infinity/NaN) are dropped', () => {
  const rs = [
    { lens: 'documentation', scores: { overall: Infinity } },
    { lens: 'documentation', scores: { overall: -Infinity } },
    { lens: 'documentation', scores: { overall: NaN } },
    { lens: 'documentation', scores: { overall: 8 } },
  ]
  // only the finite 8 survives, so it alone sets value and range
  assert.equal(reconcileScores(rs).reconciled.overall, 8)
  assert.deepEqual(reconcileScores(rs).ranges.overall, { min: 8, max: 8 })
})

// deterministic PRNG so the property tests below are reproducible.
function mulberry32(seed) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ALL_AXES = [
  'performance', 'correctness', 'engineering', 'taste',
  'documentation', 'honesty', 'overall',
]
const NON_OWNERS = ['correctness', 'engineering', 'taste', 'documentation']

test('reconcile: weighting is inert when no review owns the axis (== mean)', () => {
  // property: on a lens-owned axis with NO owning review present, the result is
  // exactly the plain mean (the 2x weight has nobody to apply to).
  const rnd = mulberry32(12345)
  const axis = 'performance' // lens-owned, but no review below has that lens
  for (let iter = 0; iter < 200; iter++) {
    const k = 1 + Math.floor(rnd() * 4)
    const vals = []
    const revs = []
    for (let j = 0; j < k; j++) {
      const v = 1 + Math.floor(rnd() * 10) // 1..10, in range
      vals.push(v)
      revs.push({ lens: NON_OWNERS[j % NON_OWNERS.length], scores: { [axis]: v } })
    }
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length
    const expected = Math.round(mean * 10) / 10
    assert.equal(reconcileScores(revs).reconciled[axis], expected)
  }
})

test('reconcile: output is invariant to review order', () => {
  const rnd = mulberry32(999)
  const lenses = [
    'performance', 'correctness', 'engineering', 'taste', 'documentation',
  ]
  for (let iter = 0; iter < 100; iter++) {
    const k = 2 + Math.floor(rnd() * 4)
    const revs = []
    for (let j = 0; j < k; j++) {
      const scores = {}
      for (const ax of ALL_AXES) {
        if (rnd() < 0.8) scores[ax] = 1 + Math.floor(rnd() * 10)
      }
      revs.push({ lens: lenses[Math.floor(rnd() * lenses.length)], scores })
    }
    const base = reconcileScores(revs)
    const shuffled = revs.slice()
    for (let m = shuffled.length - 1; m > 0; m--) {
      const n = Math.floor(rnd() * (m + 1))
      const tmp = shuffled[m]
      shuffled[m] = shuffled[n]
      shuffled[n] = tmp
    }
    assert.deepEqual(reconcileScores(shuffled), base)
  }
})

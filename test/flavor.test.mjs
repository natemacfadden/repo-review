import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPure } from './extract.mjs'

const WF = 'plugins/repo-review/lib/repo-review.js'
const { describeFlavor, KNOWN_FLAVORS } = loadPure(WF, [
  'describeFlavor',
  'KNOWN_FLAVORS',
])

test('describeFlavor: every known flavor has its own distinct guidance', () => {
  const balanced = describeFlavor(null)
  const seen = new Set()
  for (const f of KNOWN_FLAVORS) {
    const g = describeFlavor(f)
    assert.equal(typeof g, 'string')
    assert.ok(g.length > 0)
    assert.notEqual(g, balanced, `${f} should not fall back to balanced`)
    assert.ok(!seen.has(g), `${f} guidance should be unique`)
    seen.add(g)
  }
})

test('describeFlavor: null/undefined/unknown -> balanced default', () => {
  const balanced = describeFlavor(null)
  assert.ok(balanced.length > 0)
  assert.equal(describeFlavor(undefined), balanced)
  assert.equal(describeFlavor('bogus'), balanced)
})

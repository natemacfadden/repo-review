import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from '../plugins/repo-review/lib/engine.mjs'

// A fake host records every spawn and returns canned structured output, so the
// entire orchestration recipe (detect -> five lenses -> reconcile -> synth) is
// exercised with zero model calls. This is the seam the host injection buys us.
function makeHost({ flavor = null } = {}) {
  const calls = []
  const logs = []
  const host = {
    log: (m) => logs.push(m),
    spawn: (prompt, opts) => {
      calls.push({ phase: opts.phase, label: opts.label, prompt })
      if (opts.phase === 'Detect') return { flavor, rationale: 'x' }
      if (opts.phase === 'Reviews') {
        return {
          reviewedCommit: 'abc123',
          scores: {
            performance: 8, correctness: 8, engineering: 8, taste: 8,
            documentation: 8, honesty: 8, overall: 8,
          },
          recommendation: 'Good',
          reviewPath: '/out/x.md',
          summary: 'ok',
        }
      }
      // Synthesis
      return { memoPath: '/out/MEMO.md', summary: 's', verdict: 'Good',
        outliers: [] }
    },
  }
  return { host, calls, logs }
}

test('run: pinned flavor skips detect; 5 lenses then synthesis, in order', async () => {
  const { host, calls } = makeHost()
  const out = await run(host, '/repos/foo:performance')
  const phases = calls.map((c) => c.phase)
  assert.deepEqual(phases, [
    'Reviews', 'Reviews', 'Reviews', 'Reviews', 'Reviews', 'Synthesis',
  ])
  // flavor came from the pin, not a detector
  assert.equal(out.repos[0].flavor, 'performance')
})

test('run: absent flavor triggers one detect spawn and propagates it', async () => {
  const { host, calls } = makeHost({ flavor: 'research' })
  const out = await run(host, '/repos/bar')
  assert.equal(calls.filter((c) => c.phase === 'Detect').length, 1)
  assert.equal(calls[0].phase, 'Detect')
  assert.equal(out.repos[0].flavor, 'research')
})

test('run: scores are reconciled in code from the lens outputs', async () => {
  const { host } = makeHost()
  const out = await run(host, '/repos/foo:personal')
  // every lens returned 8 across the board -> reconciled overall is 8
  assert.equal(out.repos[0].scores.reconciled.overall, 8)
  assert.equal(out.repos[0].scores.reconciled.performance, 8)
})

test('run: no repos returns an error object, not a throw', async () => {
  const { host } = makeHost()
  const out = await run(host, '--profile job')
  assert.match(out.error, /no repositories/)
})

test('run: lens spawns are built independently (no cross-lens leakage)', async () => {
  const { host, calls } = makeHost()
  await run(host, '/repos/foo:production')
  const reviews = calls.filter((c) => c.phase === 'Reviews')
  // no lens prompt carries another lens's returned findings: the only shared
  // text is the fixed brief, never a sibling's output ("ok"/"Good"/scores).
  for (const c of reviews) {
    assert.doesNotMatch(c.prompt, /reviewedCommit|"overall"/)
  }
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  doorman, quoteArgs, repoPathFromLabel,
} from '../adapters/opencode/run.mjs'

// Importing run.mjs is now side-effect-free: its bottom-of-file execution is
// behind a "run only when invoked directly" guard, so these helpers can be
// tested in isolation.

// quoteArgs
// ---------

test('quoteArgs: quotes only tokens containing whitespace', () => {
  assert.equal(quoteArgs(['./repo', '--profile', 'job']), './repo --profile job')
  assert.equal(quoteArgs(['--for', 'a senior RE role']), '--for "a senior RE role"')
})

test('quoteArgs: a multi-word value survives as one quoted token', () => {
  // the exact regression: --for "RE/RS hiring board" must not be torn apart
  const out = quoteArgs(['./r', '--for', 'RE/RS hiring board'])
  assert.ok(out.includes('"RE/RS hiring board"'), out)
})

// doorman
// -------

const NOW = '2026-07-16T03:04:52.123Z'

test('doorman: injects --out/--stamp/--date when absent, deterministically', () => {
  const d = doorman('./repo', NOW, '/base')
  assert.equal(d.outBase, '/base')
  assert.equal(d.stamp, '20260716T030452Z')
  assert.match(d.args, /--out "\/base"/)
  assert.match(d.args, /--stamp 20260716T030452Z/)
  assert.match(d.args, /--date 2026-07-16/)
})

test('doorman: respects explicit --out/--stamp and strips their quotes', () => {
  const d = doorman('./repo --out "/custom/dir" --stamp MYSTAMP', NOW, '/base')
  assert.equal(d.outBase, '/custom/dir')
  assert.equal(d.stamp, 'MYSTAMP')
  // no double-injection
  assert.equal(d.args.match(/--out/g).length, 1)
  assert.equal(d.args.match(/--stamp/g).length, 1)
})

test('doorman: respects an explicit --date', () => {
  const d = doorman('./repo --date 2020-01-01', NOW, '/base')
  assert.equal(d.args.match(/--date/g).length, 1)
  assert.match(d.args, /--date 2020-01-01/)
})

// repoPathFromLabel
// -----------------

test('repoPathFromLabel: review labels drop the trailing lens key', () => {
  assert.equal(repoPathFromLabel('review:/repos/foo:engineering'), '/repos/foo')
})

test('repoPathFromLabel: non-review labels keep all after the prefix', () => {
  assert.equal(repoPathFromLabel('detect:/repos/foo'), '/repos/foo')
  assert.equal(repoPathFromLabel('synthesis:/repos/foo'), '/repos/foo')
})

test('repoPathFromLabel: paths containing colons are rejoined', () => {
  assert.equal(repoPathFromLabel('review:C:/repos/foo:taste'), 'C:/repos/foo')
  assert.equal(repoPathFromLabel('detect:C:/repos/foo'), 'C:/repos/foo')
})

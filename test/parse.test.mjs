import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPure } from './extract.mjs'

const WF = 'plugins/repo-review/workflows/repo-review.js'
const { splitRepoToken, parseArgs, normalizeArgs } = loadPure(WF, [
  'splitRepoToken',
  'parseArgs',
  'normalizeArgs',
])

test('splitRepoToken: bare path -> no flavor', () => {
  assert.deepEqual(splitRepoToken('./repo'), { path: './repo', flavor: null })
})

test('splitRepoToken: known flavor suffix splits', () => {
  assert.deepEqual(splitRepoToken('./repo:performance'), {
    path: './repo',
    flavor: 'performance',
  })
})

test('splitRepoToken: unknown suffix stays a path', () => {
  assert.deepEqual(splitRepoToken('./a:b'), { path: './a:b', flavor: null })
})

test('splitRepoToken: windows drive letter survives', () => {
  assert.deepEqual(splitRepoToken('C:/repo'), { path: 'C:/repo', flavor: null })
})

test('parseArgs: empty -> no repos, no profile', () => {
  assert.deepEqual(parseArgs(''), { repos: [], profile: null })
  assert.deepEqual(parseArgs('   '), { repos: [], profile: null })
  assert.deepEqual(parseArgs(null), { repos: [], profile: null })
})

test('parseArgs: multiple repos with per-repo flavors', () => {
  assert.deepEqual(parseArgs('./a ./b:personal ./c:performance'), {
    repos: [
      { path: './a', flavor: null },
      { path: './b', flavor: 'personal' },
      { path: './c', flavor: 'performance' },
    ],
    profile: null,
  })
})

test('parseArgs: --profile with a value, anywhere', () => {
  assert.deepEqual(parseArgs('./a --profile job ./b'), {
    repos: [{ path: './a', flavor: null }, { path: './b', flavor: null }],
    profile: 'job',
  })
})

test('parseArgs: --profile=value form', () => {
  assert.deepEqual(parseArgs('--profile=job ./a'), {
    repos: [{ path: './a', flavor: null }],
    profile: 'job',
  })
})

test('parseArgs: --profile with no value is ignored', () => {
  assert.deepEqual(parseArgs('./a --profile'), {
    repos: [{ path: './a', flavor: null }],
    profile: null,
  })
})

test('parseArgs: unknown flags are ignored, not treated as repos', () => {
  assert.deepEqual(parseArgs('./a --bogus ./b'), {
    repos: [{ path: './a', flavor: null }, { path: './b', flavor: null }],
    profile: null,
  })
})

test('normalizeArgs: string delegates to parseArgs', () => {
  const s = './a:personal --profile job'
  assert.deepEqual(normalizeArgs(s), parseArgs(s))
})

test('normalizeArgs: null/undefined -> empty', () => {
  assert.deepEqual(normalizeArgs(null), { repos: [], profile: null })
  assert.deepEqual(normalizeArgs(undefined), { repos: [], profile: null })
})

test('normalizeArgs: structured object passes through', () => {
  assert.deepEqual(
    normalizeArgs({ repos: [{ path: './a', flavor: 'personal' }], profile: 'job' }),
    { repos: [{ path: './a', flavor: 'personal' }], profile: 'job' },
  )
})

test('normalizeArgs: string repo items are split', () => {
  assert.deepEqual(normalizeArgs({ repos: ['./a:performance', './b'] }), {
    repos: [
      { path: './a', flavor: 'performance' },
      { path: './b', flavor: null },
    ],
    profile: null,
  })
})

test('normalizeArgs: unknown flavor coerced to null', () => {
  assert.deepEqual(normalizeArgs({ repos: [{ path: './a', flavor: 'bogus' }] }), {
    repos: [{ path: './a', flavor: null }],
    profile: null,
  })
})

test('normalizeArgs: bad repos shape -> empty; pathless items dropped', () => {
  assert.deepEqual(normalizeArgs({ repos: 'nope' }), { repos: [], profile: null })
  assert.deepEqual(normalizeArgs({ repos: [{ flavor: 'personal' }] }), {
    repos: [],
    profile: null,
  })
})

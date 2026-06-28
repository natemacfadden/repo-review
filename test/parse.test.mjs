import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPure } from './extract.mjs'

const WF = 'plugins/repo-review/workflows/repo-review.js'
const { splitRepoToken, parseArgs, normalizeArgs, repoSlug } = loadPure(WF, [
  'splitRepoToken',
  'parseArgs',
  'normalizeArgs',
  'repoSlug',
])

test('repoSlug: takes the last path segment, sanitized', () => {
  assert.equal(repoSlug('./my-repo'), 'my-repo')
  assert.equal(repoSlug('/home/x/foo'), 'foo')
  assert.equal(repoSlug('foo/'), 'foo')
  assert.equal(repoSlug('a b'), 'a-b')
  assert.equal(repoSlug('.'), 'repo')
  assert.equal(repoSlug(''), 'repo')
})

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

test('parseArgs: empty -> no repos, no profile, no specialization', () => {
  assert.deepEqual(parseArgs(''), { repos: [], profile: null, specialization: null })
  assert.deepEqual(parseArgs('   '), { repos: [], profile: null, specialization: null })
  assert.deepEqual(parseArgs(null), { repos: [], profile: null, specialization: null })
})

test('parseArgs: multiple repos with per-repo flavors', () => {
  assert.deepEqual(parseArgs('./a ./b:personal ./c:performance'), {
    repos: [
      { path: './a', flavor: null },
      { path: './b', flavor: 'personal' },
      { path: './c', flavor: 'performance' },
    ],
    profile: null,
    specialization: null,
  })
})

test('parseArgs: --profile with a value, anywhere', () => {
  assert.deepEqual(parseArgs('./a --profile job ./b'), {
    repos: [{ path: './a', flavor: null }, { path: './b', flavor: null }],
    profile: 'job',
    specialization: null,
  })
})

test('parseArgs: --profile=value form', () => {
  assert.deepEqual(parseArgs('--profile=job ./a'), {
    repos: [{ path: './a', flavor: null }],
    profile: 'job',
    specialization: null,
  })
})

test('parseArgs: --profile with no value is ignored', () => {
  assert.deepEqual(parseArgs('./a --profile'), {
    repos: [{ path: './a', flavor: null }],
    profile: null,
    specialization: null,
  })
})

test('parseArgs: unknown flags are ignored, not treated as repos', () => {
  assert.deepEqual(parseArgs('./a --bogus ./b'), {
    repos: [{ path: './a', flavor: null }, { path: './b', flavor: null }],
    profile: null,
    specialization: null,
  })
})

test('parseArgs: --for captures a quoted multi-word value', () => {
  const out = parseArgs('./a --profile job --for "a RE role at Anthropic"')
  assert.deepEqual(out, {
    repos: [{ path: './a', flavor: null }],
    profile: 'job',
    specialization: 'a RE role at Anthropic',
  })
})

test('parseArgs: --for=value (single word) form', () => {
  assert.equal(parseArgs('./a --for=startup').specialization, 'startup')
})

test('parseArgs: quotes keep a value together; repos still parse', () => {
  const out = parseArgs("'./a b' --for 'x y'")
  assert.deepEqual(out.repos, [{ path: './a b', flavor: null }])
  assert.equal(out.specialization, 'x y')
})

test('normalizeArgs: string delegates to parseArgs', () => {
  const s = './a:personal --profile job --for "team X"'
  assert.deepEqual(normalizeArgs(s), parseArgs(s))
})

test('normalizeArgs: null/undefined -> empty', () => {
  const empty = { repos: [], profile: null, specialization: null }
  assert.deepEqual(normalizeArgs(null), empty)
  assert.deepEqual(normalizeArgs(undefined), empty)
})

test('normalizeArgs: structured object passes through', () => {
  assert.deepEqual(
    normalizeArgs({
      repos: [{ path: './a', flavor: 'personal' }],
      profile: 'job',
      specialization: 'team X',
    }),
    {
      repos: [{ path: './a', flavor: 'personal' }],
      profile: 'job',
      specialization: 'team X',
    },
  )
})

test('normalizeArgs: string repo items are split', () => {
  assert.deepEqual(normalizeArgs({ repos: ['./a:performance', './b'] }), {
    repos: [
      { path: './a', flavor: 'performance' },
      { path: './b', flavor: null },
    ],
    profile: null,
    specialization: null,
  })
})

test('normalizeArgs: unknown flavor coerced to null', () => {
  assert.deepEqual(normalizeArgs({ repos: [{ path: './a', flavor: 'bogus' }] }), {
    repos: [{ path: './a', flavor: null }],
    profile: null,
    specialization: null,
  })
})

test('normalizeArgs: bad repos shape -> empty; pathless items dropped', () => {
  const empty = { repos: [], profile: null, specialization: null }
  assert.deepEqual(normalizeArgs({ repos: 'nope' }), empty)
  assert.deepEqual(normalizeArgs({ repos: [{ flavor: 'personal' }] }), empty)
})

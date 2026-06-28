import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPure } from './extract.mjs'

const WF = 'plugins/repo-review/lib/repo-review.js'
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

test('parseArgs: empty -> no repos, profile, specialization, outDir', () => {
  const empty = { repos: [], profile: null, specialization: null, outDir: null }
  assert.deepEqual(parseArgs(''), empty)
  assert.deepEqual(parseArgs('   '), empty)
  assert.deepEqual(parseArgs(null), empty)
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
    outDir: null,
  })
})

test('parseArgs: --profile with a value, anywhere', () => {
  assert.deepEqual(parseArgs('./a --profile job ./b'), {
    repos: [{ path: './a', flavor: null }, { path: './b', flavor: null }],
    profile: 'job',
    specialization: null,
    outDir: null,
  })
})

test('parseArgs: --profile=value form', () => {
  assert.deepEqual(parseArgs('--profile=job ./a'), {
    repos: [{ path: './a', flavor: null }],
    profile: 'job',
    specialization: null,
    outDir: null,
  })
})

test('parseArgs: --profile with no value is ignored', () => {
  assert.deepEqual(parseArgs('./a --profile'), {
    repos: [{ path: './a', flavor: null }],
    profile: null,
    specialization: null,
    outDir: null,
  })
})

test('parseArgs: unknown flags are ignored, not treated as repos', () => {
  assert.deepEqual(parseArgs('./a --bogus ./b'), {
    repos: [{ path: './a', flavor: null }, { path: './b', flavor: null }],
    profile: null,
    specialization: null,
    outDir: null,
  })
})

test('parseArgs: --for captures a quoted multi-word value', () => {
  const out = parseArgs('./a --profile job --for "a RE role at Anthropic"')
  assert.deepEqual(out, {
    repos: [{ path: './a', flavor: null }],
    profile: 'job',
    specialization: 'a RE role at Anthropic',
    outDir: null,
  })
})

test('parseArgs: --for=value (single word) form', () => {
  assert.equal(parseArgs('./a --for=startup').specialization, 'startup')
})

test('parseArgs: --out captures an absolute path (quoted, with spaces)', () => {
  const out = parseArgs('./a --out "/home/x/my proj/repo-review-out"')
  assert.deepEqual(out.repos, [{ path: './a', flavor: null }])
  assert.equal(out.outDir, '/home/x/my proj/repo-review-out')
})

test('parseArgs: --out=value form', () => {
  assert.equal(parseArgs('./a --out=/abs/out').outDir, '/abs/out')
})

test('parseArgs: --out with no value is ignored', () => {
  assert.equal(parseArgs('./a --out').outDir, null)
})

test('parseArgs: quotes keep a value together; repos still parse', () => {
  const out = parseArgs("'./a b' --for 'x y'")
  assert.deepEqual(out.repos, [{ path: './a b', flavor: null }])
  assert.equal(out.specialization, 'x y')
})

test('normalizeArgs: string delegates to parseArgs', () => {
  const s = './a:personal --profile job --for "team X" --out /abs/out'
  assert.deepEqual(normalizeArgs(s), parseArgs(s))
})

test('normalizeArgs: null/undefined -> empty', () => {
  const empty = { repos: [], profile: null, specialization: null, outDir: null }
  assert.deepEqual(normalizeArgs(null), empty)
  assert.deepEqual(normalizeArgs(undefined), empty)
})

test('normalizeArgs: structured object passes through (incl outDir)', () => {
  assert.deepEqual(
    normalizeArgs({
      repos: [{ path: './a', flavor: 'personal' }],
      profile: 'job',
      specialization: 'team X',
      outDir: '/abs/out',
    }),
    {
      repos: [{ path: './a', flavor: 'personal' }],
      profile: 'job',
      specialization: 'team X',
      outDir: '/abs/out',
    },
  )
})

test('normalizeArgs: non-string outDir coerced to null', () => {
  assert.equal(normalizeArgs({ repos: ['./a'], outDir: 42 }).outDir, null)
})

test('normalizeArgs: string repo items are split', () => {
  assert.deepEqual(normalizeArgs({ repos: ['./a:performance', './b'] }), {
    repos: [
      { path: './a', flavor: 'performance' },
      { path: './b', flavor: null },
    ],
    profile: null,
    specialization: null,
    outDir: null,
  })
})

test('normalizeArgs: unknown flavor coerced to null', () => {
  assert.deepEqual(normalizeArgs({ repos: [{ path: './a', flavor: 'bogus' }] }), {
    repos: [{ path: './a', flavor: null }],
    profile: null,
    specialization: null,
    outDir: null,
  })
})

test('normalizeArgs: bad repos shape -> empty; pathless items dropped', () => {
  const empty = { repos: [], profile: null, specialization: null, outDir: null }
  assert.deepEqual(normalizeArgs({ repos: 'nope' }), empty)
  assert.deepEqual(normalizeArgs({ repos: [{ flavor: 'personal' }] }), empty)
})

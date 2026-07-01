import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPure } from './extract.mjs'

const WF = 'plugins/repo-review/lib/repo-review.js'
const {
  splitRepoToken, parseArgs, normalizeArgs, repoSlug, repoOutDir,
  findSlugCollisions,
} = loadPure(WF, [
  'splitRepoToken',
  'parseArgs',
  'normalizeArgs',
  'repoSlug',
  'repoOutDir',
  'findSlugCollisions',
])

test('repoSlug: takes the last path segment, sanitized', () => {
  assert.equal(repoSlug('./my-repo'), 'my-repo')
  assert.equal(repoSlug('/home/x/foo'), 'foo')
  assert.equal(repoSlug('foo/'), 'foo')
  assert.equal(repoSlug('a b'), 'a-b')
  assert.equal(repoSlug('.'), 'repo')
  assert.equal(repoSlug(''), 'repo')
})

test('repoOutDir: base path, with stamp nested + sanitized beneath', () => {
  assert.equal(repoOutDir('/out', 'foo'), '/out/foo')
  assert.equal(repoOutDir('/out', 'foo', null), '/out/foo')
  assert.equal(repoOutDir('/out', 'foo', '20260630T184500Z'),
    '/out/foo/20260630T184500Z')
  // the stamp is sanitized like a slug (unsafe chars -> '-')
  assert.equal(repoOutDir('/out', 'foo', 'run 7'), '/out/foo/run-7')
})

test('findSlugCollisions: groups distinct repos sharing a slug', () => {
  const cols = findSlugCollisions([
    { path: 'a/foo' }, { path: 'b/foo' }, { path: 'c/bar' },
  ])
  assert.equal(cols.length, 1)
  assert.equal(cols[0].slug, 'foo')
  assert.deepEqual(cols[0].paths.sort(), ['a/foo', 'b/foo'])
})

test('findSlugCollisions: none when unique; safe on empty/garbage', () => {
  assert.deepEqual(findSlugCollisions([{ path: './a' }, { path: './b' }]), [])
  assert.deepEqual(findSlugCollisions([]), [])
  assert.deepEqual(findSlugCollisions(null), [])
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

const EMPTY = {
  repos: [], profile: null, specialization: null, outDir: null, stamp: null,
  date: null,
}

test('parseArgs: empty -> no repos, profile, specialization, outDir', () => {
  assert.deepEqual(parseArgs(''), EMPTY)
  assert.deepEqual(parseArgs('   '), EMPTY)
  assert.deepEqual(parseArgs(null), EMPTY)
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
    stamp: null,
    date: null,
  })
})

test('parseArgs: --profile with a value, anywhere', () => {
  assert.deepEqual(parseArgs('./a --profile job ./b'), {
    repos: [{ path: './a', flavor: null }, { path: './b', flavor: null }],
    profile: 'job',
    specialization: null,
    outDir: null,
    stamp: null,
    date: null,
  })
})

test('parseArgs: --profile=value form', () => {
  assert.deepEqual(parseArgs('--profile=job ./a'), {
    repos: [{ path: './a', flavor: null }],
    profile: 'job',
    specialization: null,
    outDir: null,
    stamp: null,
    date: null,
  })
})

test('parseArgs: --profile with no value is ignored', () => {
  assert.deepEqual(parseArgs('./a --profile'), {
    repos: [{ path: './a', flavor: null }],
    profile: null,
    specialization: null,
    outDir: null,
    stamp: null,
    date: null,
  })
})

test('parseArgs: unknown flags are ignored, not treated as repos', () => {
  assert.deepEqual(parseArgs('./a --bogus ./b'), {
    repos: [{ path: './a', flavor: null }, { path: './b', flavor: null }],
    profile: null,
    specialization: null,
    outDir: null,
    stamp: null,
    date: null,
  })
})

test('parseArgs: --for captures a quoted multi-word value', () => {
  const out = parseArgs('./a --profile job --for "a RE role at Anthropic"')
  assert.deepEqual(out, {
    repos: [{ path: './a', flavor: null }],
    profile: 'job',
    specialization: 'a RE role at Anthropic',
    outDir: null,
    stamp: null,
    date: null,
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

test('parseArgs: --stamp captures a value; --stamp= form too', () => {
  assert.equal(parseArgs('./a --stamp 20260630T184500Z').stamp,
    '20260630T184500Z')
  assert.equal(parseArgs('./a --stamp=run7').stamp, 'run7')
})

test('parseArgs: --stamp with no value is ignored', () => {
  assert.equal(parseArgs('./a --stamp').stamp, null)
})

test('parseArgs: empty-path repos (a quoted "") are dropped', () => {
  // parity with the structured-object branch, which filters pathless items.
  assert.deepEqual(parseArgs('"" ./a').repos, [{ path: './a', flavor: null }])
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
  assert.deepEqual(normalizeArgs(null), EMPTY)
  assert.deepEqual(normalizeArgs(undefined), EMPTY)
})

test('normalizeArgs: structured object passes through (outDir, stamp, date)', () => {
  assert.deepEqual(
    normalizeArgs({
      repos: [{ path: './a', flavor: 'personal' }],
      profile: 'job',
      specialization: 'team X',
      outDir: '/abs/out',
      stamp: 'run9',
      date: '2025-01-15',
    }),
    {
      repos: [{ path: './a', flavor: 'personal' }],
      profile: 'job',
      specialization: 'team X',
      outDir: '/abs/out',
      stamp: 'run9',
      date: '2025-01-15',
    },
  )
})

test('normalizeArgs: non-string outDir/stamp coerced to null', () => {
  assert.equal(normalizeArgs({ repos: ['./a'], outDir: 42 }).outDir, null)
  assert.equal(normalizeArgs({ repos: ['./a'], stamp: 42 }).stamp, null)
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
    stamp: null,
    date: null,
  })
})

test('normalizeArgs: unknown flavor coerced to null', () => {
  assert.deepEqual(normalizeArgs({ repos: [{ path: './a', flavor: 'bogus' }] }), {
    repos: [{ path: './a', flavor: null }],
    profile: null,
    specialization: null,
    outDir: null,
    stamp: null,
    date: null,
  })
})

test('normalizeArgs: bad repos shape -> empty; pathless items dropped', () => {
  assert.deepEqual(normalizeArgs({ repos: 'nope' }), EMPTY)
  assert.deepEqual(normalizeArgs({ repos: [{ flavor: 'personal' }] }), EMPTY)
})

test('normalizeArgs: JSON-stringified object is recovered, not tokenized', () => {
  // a structured object can arrive serialized to a string in transit; it must
  // round-trip to the same result as the object form, NOT get tokenized into
  // bogus repos (one per JSON fragment / --for word).
  const obj = {
    repos: [{ path: '.', flavor: 'production' }],
    profile: 'oss-audit',
    specialization: 'judge it as a distributable plugin, not a dependency',
    outDir: '/abs/out',
  }
  assert.deepEqual(normalizeArgs(JSON.stringify(obj)), normalizeArgs(obj))
  // and concretely: exactly one repo, not a fragment-per-word fan-out.
  assert.deepEqual(normalizeArgs(JSON.stringify(obj)).repos, [
    { path: '.', flavor: 'production' },
  ])
})

test('normalizeArgs: malformed JSON-ish string falls through to parseArgs', () => {
  // leading "{" but not valid JSON -> no throw, parsed as a raw arg string.
  const s = '{ not json --profile job'
  assert.deepEqual(normalizeArgs(s), parseArgs(s))
})

test('normalizeArgs: JSON array string is not treated as an object', () => {
  // only a JSON *object* is recovered; an array string is left to parseArgs.
  const s = '["./a", "./b"]'
  assert.deepEqual(normalizeArgs(s), parseArgs(s))
})

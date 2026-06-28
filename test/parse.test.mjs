import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPure } from './extract.mjs'

const WF = 'plugins/repo-review/workflows/repo-review.js'
const { splitRepoToken } = loadPure(WF, ['splitRepoToken'])

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

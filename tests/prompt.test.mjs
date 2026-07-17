import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from '../src/engine.mjs'
import { resolveProfile } from '../src/engine.mjs'
import { describeFlavor } from '../src/content.mjs'
import { repoSlug, repoOutDir } from '../src/util.mjs'

// we drive run() with a fake host that records each prompt (no model calls),
// and compute what each prompt should contain from the same helpers the engine
// uses - rather than hardcoding magic strings.

const LENS_KEYS = [
  'performance', 'correctness', 'engineering', 'taste', 'documentation',
]

// helpers
// -------

// canned lens output, so run() can finish end-to-end with no model calls.
function cannedReview() {
  return {
    reviewedCommit: 'abc123',
    scores: {
      performance: 8, correctness: 8, engineering: 8, taste: 8,
      documentation: 8, honesty: 8, overall: 8,
    },
    recommendation: 'ok', reviewPath: '/out/x.md', summary: 'ok',
  }
}

// run() once with a fake host and return every recorded spawn call. Same seam
// as run.test.mjs: the fake spawn records the prompt and returns canned output.
async function capture(args, options) {
  const flavor = options && options.flavor ? options.flavor : null
  const calls = []
  const host = {
    log: function () {},
    spawn: function (prompt, opts) {
      calls.push({ phase: opts.phase, label: opts.label, prompt: prompt })
      if (opts.phase === 'Detect') return { flavor: flavor, rationale: 'x' }
      if (opts.phase === 'Reviews') return cannedReview()
      return { memoPath: '/out/MEMO.md', summary: 's', verdict: 'ok', outliers: [] }
    },
  }
  await run(host, args)
  return calls
}

function promptForPhase(calls, phase) {
  for (const c of calls) {
    if (c.phase === phase) return c.prompt
  }
  return null
}

// review labels are "review:<path>:<lensKey>", so the key is the last segment.
function reviewPromptForLens(calls, lensKey) {
  for (const c of calls) {
    if (c.phase === 'Reviews' && c.label.endsWith(':' + lensKey)) return c.prompt
  }
  return null
}

// tests
// -----

test('prompt: no interpolation garbage across profile/flavor/stamp/date', async () => {
  const profiles = ['', 'job', 'oss-audit', 'student-project'] // '' -> default
  const flavors = ['performance', 'research', 'production', 'personal', null]
  const withStamp = ['', ' --stamp 2026-07-16T000000Z']
  const withDate = ['', ' --date 2026-07-16']
  // 'undefined'/'[object Object]'/'NaN' never appear legitimately, so any of
  // them is proof a template value came out missing or wrongly stringified.
  const garbage = ['undefined', '[object Object]', 'NaN']

  for (const profile of profiles) {
    for (const flavor of flavors) {
      for (const stamp of withStamp) {
        for (const date of withDate) {
          let args = '/repos/foo'
          if (flavor) args += ':' + flavor
          if (profile) args += ' --profile ' + profile
          args += ' --out /base' + stamp + date

          const calls = await capture(args, { flavor: flavor })
          for (const c of calls) {
            for (const token of garbage) {
              assert.ok(
                !c.prompt.includes(token),
                '"' + token + '" leaked into ' + c.phase + ' prompt for: ' + args,
              )
            }
          }
        }
      }
    }
  }
})

test('prompt: repo path appears in detect, all reviews, synthesis', async () => {
  const calls = await capture('/repos/foo --out /base', { flavor: null })
  const path = '/repos/foo'
  assert.ok(promptForPhase(calls, 'Detect').includes(path))
  for (const key of LENS_KEYS) {
    assert.ok(reviewPromptForLens(calls, key).includes(path), 'path missing in ' + key)
  }
  assert.ok(promptForPhase(calls, 'Synthesis').includes(path))
})

test('prompt: five distinct lens briefs, keyed; new roles present', async () => {
  const calls = await capture('/repos/foo:production --out /base')

  const reviewPrompts = []
  for (const c of calls) {
    if (c.phase === 'Reviews') reviewPrompts.push(c.prompt)
  }
  assert.equal(reviewPrompts.length, 5)

  // exactly the five lens keys are present
  for (const key of LENS_KEYS) {
    assert.ok(reviewPromptForLens(calls, key), 'no review prompt for ' + key)
  }
  // all five briefs differ (no lens received another lens's text)
  const distinct = new Set(reviewPrompts)
  assert.equal(distinct.size, 5)

  // the two roles we added land on the right lenses
  assert.match(reviewPromptForLens(calls, 'engineering'), /security/i)
  assert.match(
    reviewPromptForLens(calls, 'documentation'),
    /AI-generated|AI boilerplate|slop/i,
  )
})

test('prompt: resolved profile fields all appear in the review brief', async () => {
  const names = ['', 'job', 'oss-audit']
  for (const name of names) {
    const profile = resolveProfile(name === '' ? null : name)
    let args = '/repos/foo:production --out /base'
    if (name) args += ' --profile ' + name
    const calls = await capture(args)
    const review = reviewPromptForLens(calls, 'correctness')

    assert.ok(review.includes(profile.audience), 'audience missing for ' + name)
    assert.ok(review.includes(profile.purpose), 'purpose missing for ' + name)
    assert.ok(review.includes(profile.bar), 'bar missing for ' + name)
    for (const verdict of profile.verdicts) {
      assert.ok(
        review.includes(verdict),
        'verdict "' + verdict + '" missing for ' + name,
      )
    }
  }
})

test('prompt: output path carries stamp; date line only with date', async () => {
  const slug = repoSlug('/repos/foo')
  const stamp = '2026-07-16T000000Z'
  const expectedDir = repoOutDir('/base', slug, stamp)

  const withDate = await capture(
    '/repos/foo:production --out /base --stamp ' + stamp + ' --date 2026-07-16',
  )
  const rev = reviewPromptForLens(withDate, 'performance')
  assert.ok(
    rev.includes(expectedDir + '/performance.md'), 'stamped output path missing')
  assert.ok(
    rev.includes("Today's date is 2026-07-16"),
    'date line missing when date given')

  const noDate = await capture('/repos/foo:production --out /base --stamp ' + stamp)
  const rev2 = reviewPromptForLens(noDate, 'performance')
  assert.ok(!rev2.includes("Today's date is"), 'date line present when no date given')
})

test('prompt: flavor guidance text appears for a pinned flavor', async () => {
  const calls = await capture('/repos/foo:performance --out /base')
  const expected = describeFlavor('performance')
  assert.ok(
    reviewPromptForLens(calls, 'taste').includes(expected),
    'flavor missing in review')
  assert.ok(
    promptForPhase(calls, 'Synthesis').includes(expected),
    'flavor missing in synthesis')
})

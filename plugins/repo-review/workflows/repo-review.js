// repo-review - clone + build + run a repo, review across five lenses, synthesize
//
// STUB. structure only; logic ported in a later step.
// design: CORE lenses + clone/build/run, with a swappable PROFILE overlay

export const meta = {
  name: 'repo-review',
  description:
    'Clone, build, and run a repo, then review it across five lenses ' +
    '(performance, correctness, engineering, taste & positioning, docs) and ' +
    'synthesize a scored review under a selectable profile.',
  whenToUse:
    'Evaluate a code repo by actually standing it up and running it. Pass ' +
    'args = { repoPath, profile?, ...overrides } or a bare repo-path string. ' +
    'Default profile is a general code-quality review.',
  phases: [
    { title: 'Reviews', detail: 'one reviewer per lens' },
    { title: 'Synthesis', detail: 'reconcile scores + write the memo' },
  ],
}

// >>> pure: deterministic helpers, extracted for unit tests (test/extract.mjs).
// must use no workflow globals (agent/parallel/args/...) - pure functions only.
const KNOWN_FLAVORS = ['performance', 'research', 'production', 'personal']

// split a repo token into { path, flavor }. only treat a trailing :suffix as a
// flavor when it names a known flavor; otherwise the whole token is the path
// (so absolute paths and windows drive letters survive intact).
function splitRepoToken(token) {
  const i = token.lastIndexOf(':')
  if (i > 0) {
    const suffix = token.slice(i + 1)
    if (KNOWN_FLAVORS.includes(suffix)) {
      return { path: token.slice(0, i), flavor: suffix }
    }
  }
  return { path: token, flavor: null }
}

// parse the raw command argument string into { repos, profile }.
// `--profile <name>` (or --profile=<name>) sets the run-level profile; every
// other non-flag token is a repo, optionally path:flavor. whitespace-delimited
// (paths containing spaces are not supported); unknown --flags are ignored.
function parseArgs(argstr) {
  const raw = String(argstr == null ? '' : argstr).trim()
  const tokens = raw ? raw.split(/\s+/) : []
  const repos = []
  let profile = null
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === '--profile') {
      const next = tokens[i + 1]
      if (next && !next.startsWith('--')) { profile = next; i++ }
    } else if (t.startsWith('--profile=')) {
      profile = t.slice('--profile='.length) || profile
    } else if (t.startsWith('--')) {
      // unknown flag - ignore
    } else {
      repos.push(splitRepoToken(t))
    }
  }
  return { repos, profile }
}

// normalize whatever the command passes - a raw string or a structured object
// - into { repos: [{path, flavor}], profile }. strings go through parseArgs;
// objects are validated/coerced and unknown flavors dropped to null.
function normalizeArgs(args) {
  if (typeof args === 'string' || args == null) {
    return parseArgs(args == null ? '' : args)
  }
  const profile = typeof args.profile === 'string' ? args.profile : null
  const list = Array.isArray(args.repos) ? args.repos : []
  const repos = list
    .map(r => {
      if (typeof r === 'string') return splitRepoToken(r)
      const path = r && typeof r.path === 'string' ? r.path : ''
      const flavor = r && KNOWN_FLAVORS.includes(r.flavor) ? r.flavor : null
      return { path, flavor }
    })
    .filter(r => r.path)
  return { repos, profile }
}

// the world of allowed profiles. a profile sets WHO is judging and the verdict
// scale; flavor (what the repo is for) is orthogonal. framing text per profile
// is added at the prompt-building step.
const PROFILES = {
  general: {
    label: 'general code-quality review',
    verdicts: ['Excellent', 'Good', 'Fair', 'Poor'],
  },
  job: {
    label: 'job-application portfolio piece',
    verdicts: ['Strong Hire', 'Hire', 'Lean Hire', 'Lean No-Hire', 'No-Hire'],
  },
  'oss-audit': {
    label: 'open-source health / adoptability',
    verdicts: ['Adopt', 'Use with care', 'Avoid'],
  },
  'student-project': {
    label: 'student learning project',
    verdicts: ['A', 'B', 'C', 'D', 'F'],
  },
}
const DEFAULT_PROFILE = 'general'

// resolve a profile name to its config. null/empty -> default; unknown throws
// (a typo silently becoming `general` would misrepresent the review given).
function resolveProfile(name) {
  const key = name == null || name === '' ? DEFAULT_PROFILE : name
  if (!Object.prototype.hasOwnProperty.call(PROFILES, key)) {
    const valid = Object.keys(PROFILES).join(', ')
    throw new Error(`unknown profile ${JSON.stringify(name)} (valid: ${valid})`)
  }
  return { name: key, ...PROFILES[key] }
}

// the 7 scored axes (each 1-10). the first five are lens-owned: a reviewer
// whose lens matches the axis is the specialist for it.
const SCORE_AXES = [
  'performance', 'correctness', 'engineering', 'taste',
  'documentation', 'honesty', 'overall',
]
const LENS_OWNED = new Set([
  'performance', 'correctness', 'engineering', 'taste', 'documentation',
])
const OWNER_WEIGHT = 2

// reconcile per-axis scores across reviews. on a lens-owned axis the owning
// reviewer counts OWNER_WEIGHT, others 1 (weighted mean); honesty/overall have
// no owner, so plain mean. also report the min-max range per axis. an axis
// with no numeric scores reconciles to null.
function reconcileScores(reviews) {
  const list = Array.isArray(reviews) ? reviews : []
  const reconciled = {}
  const ranges = {}
  for (const axis of SCORE_AXES) {
    let weighted = 0, wsum = 0, n = 0
    let min = Infinity, max = -Infinity
    for (const r of list) {
      const s = r && r.scores ? r.scores[axis] : undefined
      if (typeof s !== 'number' || Number.isNaN(s)) continue
      const w = LENS_OWNED.has(axis) && r.lens === axis ? OWNER_WEIGHT : 1
      weighted += s * w
      wsum += w
      n++
      if (s < min) min = s
      if (s > max) max = s
    }
    reconciled[axis] = n ? Math.round((weighted / wsum) * 10) / 10 : null
    ranges[axis] = n ? { min, max } : null
  }
  return { reconciled, ranges }
}
// <<< pure

// TODO(port): CORE lenses, clone/build/run machinery, schemas, orchestration
// TODO(port): PROFILE overlay selected by args.profile (default: general)
throw new Error('repo-review workflow not yet implemented - scaffold only')

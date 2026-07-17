// repo-review engine: argument parsing, profile resolution, score
// reconciliation, schema building, and the sequential orchestration loop. the
// prompt text and tuning tables live in content.mjs, pure helpers in util.mjs.
// scripts/build-cc.mjs inlines all three into the repo-review.js artifact
import { repoSlug } from './util.mjs'
import {
  PROFILES, DEFAULT_PROFILE, LENSES,
  detectPrompt, reviewPrompt, synthesisPrompt,
} from './content.mjs'

export const meta = {
  name: 'repo-review',
  description:
    'Clone, build, run, and review repos across five lenses; synthesize.',
  whenToUse:
    'Stand repos up and review them; args: repos and --profile/--for/--out.',
  phases: [
    { title: 'Detect', detail: 'per-repo flavor detection (when not given)' },
    { title: 'Reviews', detail: 'five lens reviewers per repo, one at a time' },
    { title: 'Synthesis', detail: 'reconcile (code) + write the memo' },
  ],
}

// plugin version - bump on every behavior change and keep in sync with
// .claude-plugin/plugin.json (check.sh enforces the match). printed at the
// start of every run so logs always identify which build produced them.
const VERSION = '0.2.9'

// argument parsing
// ----------------
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

// whitespace-split into tokens, honoring "double" and 'single' quotes so a
// quoted value (e.g. --for "a RE role at Anthropic") stays one token.
function tokenize(str) {
  const out = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m
  while ((m = re.exec(str)) !== null) {
    out.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3])
  }
  return out
}

// the flags, mapped to their result keys - the single source both parsing
// regexes are built from, so adding a flag is a one-line change.
const FLAGS = {
  profile: 'profile', for: 'specialization', out: 'outDir',
  stamp: 'stamp', date: 'date',
}
const FLAG_ALT = Object.keys(FLAGS).join('|')
// agents often misspell flags with a single dash (-for): accept those as
// their double-dash form, with a warning, instead of degrading flag + value
// into two bogus repos.
const SINGLE_DASH_RE = new RegExp(`^-(${FLAG_ALT})(=.*)?$`)
const FLAG_RE = new RegExp(`^--(${FLAG_ALT})(?:=(.*))?$`)

// parse the raw arg string into { repos, profile, specialization, outDir,
// stamp, date, warnings }. flags take `--flag value` or `--flag=value` form
// (quote multi-word values); other non-flag tokens are repos.
function parseArgs(argstr) {
  const tokens = tokenize(String(argstr == null ? '' : argstr))
  const warnings = []
  const repos = []
  const opts = {
    profile: null, specialization: null, outDir: null, stamp: null, date: null,
  }
  for (let i = 0; i < tokens.length; i++) {
    let t = tokens[i]
    if (SINGLE_DASH_RE.test(t)) {
      warnings.push(`read ${t} as -${t} (flags are double-dash)`)
      t = `-${t}`
    }
    const m = FLAG_RE.exec(t)
    if (m) {
      const key = FLAGS[m[1]]
      const next = tokens[i + 1]
      const val = m[2] !== undefined
        ? m[2]
        : next && !next.startsWith('--') ? tokens[++i] : null
      opts[key] = val || opts[key]
    } else if (t.startsWith('-')) {
      // unknown flag (either dash style) - ignore, but say so: a silently
      // dropped token is invisible to the agent that sent it
      warnings.push(`ignoring unknown flag ${t}`)
    } else {
      repos.push(splitRepoToken(t))
    }
  }
  // drop empty-path repos (e.g. a quoted "" token) for parity with the
  // structured-object branch in normalizeArgs, which filters pathless items.
  return { repos: repos.filter(r => r.path), ...opts, warnings }
}

// normalize args into { repos: [{path, flavor}], profile, specialization,
// outDir }. the command passes one raw arg string (parseArgs handles it); a
// structured object is also accepted defensively - not a documented shape, but
// a programmatic caller could hand one over, so we coerce rather than mis-parse
function normalizeArgs(args) {
  // a structured object (or array) may arrive JSON-serialized in transit;
  // recover it before raw-arg parsing, else its fragments tokenize into bogus
  // repos (each --for word becomes a repo), fanning out junk reviews
  if (typeof args === 'string' && /^[{[]/.test(args.trim())) {
    let parsed = null
    try {
      parsed = JSON.parse(args.trim())
    } catch {
      // not valid JSON - leave it for raw-arg-string parsing below
    }
    if (parsed && typeof parsed === 'object') {
      return normalizeArgs(parsed)
    }
  }
  if (typeof args === 'string' || args == null) {
    return parseArgs(args == null ? '' : args)
  }
  // a bare array is an unambiguous repo list; coerce it rather than reject
  // (rejecting it has stranded agents on "no repositories given")
  if (Array.isArray(args)) return normalizeArgs({ repos: args })
  const warnings = []
  const profile = typeof args.profile === 'string' ? args.profile : null
  const specialization =
    typeof args.specialization === 'string' ? args.specialization : null
  const outDir = typeof args.outDir === 'string' ? args.outDir : null
  const stamp = typeof args.stamp === 'string' ? args.stamp : null
  const date = typeof args.date === 'string' ? args.date : null
  let list = Array.isArray(args.repos) ? args.repos : []
  if (typeof args.repos === 'string') {
    warnings.push('repos should be an array of paths; wrapped the string')
    list = [args.repos]
  }
  const repos = list
    .map(r => {
      if (typeof r === 'string') return splitRepoToken(r)
      const path = r && typeof r.path === 'string' ? r.path : ''
      const flavor = r && KNOWN_FLAVORS.includes(r.flavor) ? r.flavor : null
      return { path, flavor }
    })
    .filter(r => r.path)
  return { repos, profile, specialization, outDir, stamp, date, warnings }
}

// one-line description of a received args value, for the no-repositories
// error: the caller is usually an agent that mis-shaped its input, so show
// what arrived so it can see how it was interpreted.
function describeArgs(args) {
  if (args == null) return 'nothing'
  if (typeof args === 'string') {
    const s = args.length > 80 ? `${args.slice(0, 77)}...` : args
    return `the string ${JSON.stringify(s)}`
  }
  if (Array.isArray(args)) return `an array of ${args.length} item(s)`
  if (typeof args === 'object') {
    return `an object with keys {${Object.keys(args).join(', ')}}`
  }
  return `a ${typeof args}`
}

// single-source usage contract, built from the tables so it can't drift.
// shown as the first log line of every run, appended to the no-repositories
// error, and printed verbatim by the review command - so a watching human and
// a mis-calling agent both see the full argument surface up front
const USAGE =
  'usage: args is ONE raw string \'<repo-path[:flavor]>... ' +
  '[--profile <name>] [--for "<text>"] [--out <abs-dir>] ' +
  '[--stamp <token>] [--date <YYYY-MM-DD>]\' (or an object ' +
  '{repos: ["<path>"], profile, specialization, outDir, stamp, date}). ' +
  `flavors: ${KNOWN_FLAVORS.join('|')} (omit to auto-detect). profiles: ` +
  `${Object.keys(PROFILES).join('|')} (default ${DEFAULT_PROFILE}). ` +
  '--for layers free-text specialization on the profile (quote ' +
  'multi-word values).'

// resolve a profile name to its config. null/empty -> default; unknown throws
// (a typo silently becoming `general` would misrepresent the review given).
function resolveProfile(name, specialization) {
  const key = name == null || name === '' ? DEFAULT_PROFILE : name
  if (!Object.prototype.hasOwnProperty.call(PROFILES, key)) {
    const valid = Object.keys(PROFILES).join(', ')
    throw new Error(`unknown profile ${JSON.stringify(name)} (valid: ${valid})`)
  }
  const p = { name: key, ...PROFILES[key] }
  if (specialization) {
    p.specialization = specialization
    p.audience = `${p.audience} (specifically: ${specialization})`
    p.purpose = `${p.purpose}, specifically for: ${specialization}`
  }
  return p
}

// score reconciliation
// --------------------
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

// the legal score range, every axis (kept in sync with SCORE_PROPS' schema
// bounds, which reference these). reconcileScores clamps to it defensively.
const SCORE_MIN = 1
const SCORE_MAX = 10

// clamp a finite score into [SCORE_MIN, SCORE_MAX].
function clampScore(s) {
  return s < SCORE_MIN ? SCORE_MIN : s > SCORE_MAX ? SCORE_MAX : s
}

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
      const raw = r && r.scores ? r.scores[axis] : undefined
      // defense in depth vs. the schema: drop non-finite scores (NaN, +/-Inf,
      // non-numbers) outright, and clamp the rest into the legal range so an
      // out-of-band value can't silently skew the weighted mean or the range.
      if (!Number.isFinite(raw)) continue
      const s = clampScore(raw)
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

// fallback output base, used only when the command passes no --out: per-lens
// reviews and memos are written here (outside the temp clones, which get
// deleted). normally the command passes an absolute --out, so the run uses
// outBase = outDir || OUTDIR.
const OUTDIR = 'repo-review-out'

// stall headroom per agent() call. claude-code's per-agent stall watchdog
// (opts.stallMs, default 180s) kills+retries a turn after that long without a
// transcript event; a reviewer's long final write exceeds it, looping same-lens
// retries. 15 min only delays recovery from a true hang, never slows a good run
const AGENT_STALL_MS = 900000

// distinct repos can share a slug (e.g. a/foo and b/foo) and would write to the
// same output dir, clobbering each other. group the given repos by slug and
// return only the colliding groups ({ slug, paths }), so the caller can warn.
function findSlugCollisions(repos) {
  const bySlug = new Map()
  for (const r of Array.isArray(repos) ? repos : []) {
    const path = r && r.path
    if (!path) continue           // no path -> nothing to collide; skip garbage
    const slug = repoSlug(path)
    if (!bySlug.has(slug)) bySlug.set(slug, [])
    bySlug.get(slug).push(path)
  }
  const collisions = []
  for (const [slug, paths] of bySlug) {
    if (paths.length > 1) collisions.push({ slug, paths })
  }
  return collisions
}

// schemas
// -------
// built per-run; recommendation/verdict use the profile's verdicts
const SCORE_PROPS = Object.fromEntries(
  SCORE_AXES.map(a => [
    a, { type: 'number', minimum: SCORE_MIN, maximum: SCORE_MAX },
  ]),
)
const DETECT_SCHEMA = {
  type: 'object',
  required: ['flavor'],
  properties: {
    flavor: { type: ['string', 'null'], enum: [...KNOWN_FLAVORS, null] },
    rationale: { type: 'string' },
  },
}
// built per-run so `recommendation` validates against the profile's verdicts.
function buildReviewSchema(profile) {
  return {
    type: 'object',
    required: ['reviewedCommit', 'scores', 'recommendation', 'reviewPath',
      'summary'],
    properties: {
      reviewedCommit: { type: 'string', description: 'commit reviewed' },
      scores: { type: 'object', required: SCORE_AXES, properties: SCORE_PROPS },
      scoreJustifications: { type: 'object', description: 'one line per axis' },
      recommendation: { type: 'string', enum: profile.verdicts },
      strengths: { type: 'array', items: { type: 'string' } },
      weaknesses: { type: 'array', items: { type: 'string' } },
      testsWritten: { type: 'string', description: 'tests you wrote + results' },
      oversellAssessment: { type: 'string' },
      reviewPath: { type: 'string', description: 'path of the written review' },
      summary: { type: 'string', description: 'one-line summary' },
      cleanupConfirmed: { type: 'boolean' },
      caveats: {
        type: 'array', items: { type: 'string' },
        description: 'limits of THIS review (e.g. web tools unavailable) - ' +
          'NOT repo faults; never lower a score for these',
      },
    },
  }
}
// built per-run so `verdict` validates against the profile's verdicts.
function buildSynthesisSchema(profile) {
  const strs = { type: 'array', items: { type: 'string' } }
  return {
    type: 'object',
    required: ['memoPath', 'summary', 'verdict', 'outliers'],
    properties: {
      memoPath: { type: 'string', description: 'path of the written memo' },
      summary: { type: 'string', description: 'short summary: verdict + why' },
      verdict: { type: 'string', enum: profile.verdicts },
      provenance: { type: 'string', description: 'commit(s) reviewed' },
      outliers: strs,
      disagreements: strs,
      consensusStrengths: strs,
      consensusWeaknesses: strs,
      oversellAssessment: { type: 'string' },
      fixes: strs,
    },
  }
}

// orchestration
// -------------
// fully sequential by design: repos one at a time, and the five lens reviewers
// one at a time within each. only one clone/build/run is ever active, so
// profiling/benchmarks are uncontended and RAM stays bounded
// advertise the argument contract before anything else can fail on it
async function run(host, args) {
host.log(USAGE)
const { repos, profile: profileName, specialization, outDir, stamp, date,
  warnings } = normalizeArgs(args)
for (const w of warnings || []) host.log(`WARNING: args - ${w}`)
const profile = resolveProfile(profileName, specialization)
if (!repos.length) {
  return {
    error: `no repositories given - received ${describeArgs(args)}; ` +
      USAGE,
    profile: profile.name,
  }
}
// echo the parsed interpretation so a mis-parse is visible immediately
host.log(`args parsed: repos [${repos.map(
  r => r.path + (r.flavor ? `:${r.flavor}` : '')).join(', ')}]` +
  (specialization ? `, for "${specialization}"` : ''))
// absolute output base passed by the command (--out <pwd>/repo-review-out) so
// docs land deterministically at the invocation dir regardless of where lens
// agents cd to; falls back to the relative default for direct invocation.
const outBase = outDir || OUTDIR
// a run stamp (passed by the command, since the engine can't read the clock)
// nests each run's docs under <outBase>/<slug>/<stamp>, so re-runs don't
// clobber earlier ones. absent -> docs land directly under <outBase>/<slug>.
const reviewSchema = buildReviewSchema(profile)
const synthesisSchema = buildSynthesisSchema(profile)
host.log(`repo-review v${VERSION}: ${repos.length} repo(s), profile ` +
  `${profile.name}, output -> ${outBase}${stamp ? `/<slug>/${stamp}` : ''}`)
// distinct repos sharing a slug write to the same dir and would clobber each
// other (the stamp doesn't separate same-run repos) - warn so it's not silent.
for (const c of findSlugCollisions(repos)) {
  host.log(`WARNING: output-slug collision on "${c.slug}" - these repos overwrite ` +
    `each other's docs: ${c.paths.join(', ')}`)
}
host.log(
  `heads-up - thorough, token-heavy run: every lens clones, builds, and ` +
  `runs the code over a long session (the deeper lenses also write their ` +
  `own tests). expect very roughly ~10-20M tokens (mostly cache reads), ` +
  `~80-130k output, ~0.5-2h per repo. on metered API that is ~$30-50/repo ` +
  `(Opus), but a Claude subscription subsidizes this heavily - it runs ` +
  `easily on a $100/mo plan. interrupt now if unintended.`
)

const results = []
let n = 0
for (const repo of repos) {
  n++
  const tag = `[${n}/${repos.length}] ${repo.path}`
  host.log(`${tag}: starting`)

  // resolve flavor: detect only when not given inline
  let flavor = repo.flavor
  if (!flavor) {
    host.log(`${tag}: detect - classifying flavor`)
    const d = await host.spawn(detectPrompt(repo), {
      label: `detect:${repo.path}`, phase: 'Detect', schema: DETECT_SCHEMA,
      stallMs: AGENT_STALL_MS,
    })
    flavor = (d && d.flavor) || null
    host.log(`${tag}: detect done - flavor ${flavor || 'balanced'}`)
  } else {
    host.log(`${tag}: flavor ${flavor} (given)`)
  }

  // five lens reviewers, strictly one at a time
  host.log(`${tag}: reviews - ${LENSES.length} lenses, one at a time`)
  const reviews = []
  for (const lens of LENSES) {
    host.log(`${tag}: review start - ${lens.title}`)
    const r = await host.spawn(
      reviewPrompt(repo, lens, profile, flavor, outBase, stamp, date),
      {
        label: `review:${repo.path}:${lens.key}`,
        phase: 'Reviews', schema: reviewSchema, stallMs: AGENT_STALL_MS,
      },
    )
    if (r) {
      reviews.push({ ...r, lens: lens.key })
      const ov = r.scores ? r.scores.overall : '?'
      host.log(`${tag}: review done - ${lens.title}: overall ${ov}, ` +
        `${r.recommendation} - ${r.summary || ''}`)
    } else {
      host.log(`${tag}: review FAILED - ${lens.title}`)
    }
  }

  const scores = reconcileScores(reviews)
  host.log(`${tag}: reconciled ${reviews.length}/${LENSES.length} - overall ` +
    `${scores.reconciled.overall}`)

  // synthesis narrates + identifies outliers + writes the memo; it does NOT
  // recompute the scores (those come from reconcileScores above)
  host.log(`${tag}: synthesis - writing memo`)
  const synthesis = await host.spawn(
    synthesisPrompt(repo, profile, flavor, reviews, scores, outBase, stamp, date),
    {
      label: `synthesis:${repo.path}`,
      phase: 'Synthesis',
      schema: synthesisSchema,
      stallMs: AGENT_STALL_MS,
    },
  )
  if (synthesis) {
    const cs = (synthesis.consensusStrengths || []).length
    const cw = (synthesis.consensusWeaknesses || []).length
    const ol = (synthesis.outliers || []).length
    host.log(`${tag}: VERDICT ${synthesis.verdict} (overall ` +
      `${scores.reconciled.overall})\n  ${synthesis.summary || ''}\n  ` +
      `consensus: +${cs} / -${cw}; ${ol} outliers; ` +
      `memo -> ${synthesis.memoPath || '(unwritten)'}`)
  } else {
    host.log(`${tag}: synthesis FAILED`)
  }

  results.push({ repo: repo.path, flavor, scores, synthesis })
}

host.log(`repo-review: finished ${results.length}/${repos.length} repo(s)`)
for (const res of results) {
  const v = res.synthesis ? res.synthesis.verdict : '(synthesis failed)'
  host.log(`  ${res.repo}: ${v} (overall ${res.scores.reconciled.overall})`)
}

return { profile: profile.name, repos: results }
}

export {
  run, KNOWN_FLAVORS, splitRepoToken, parseArgs, normalizeArgs, describeArgs,
  USAGE, resolveProfile, reconcileScores, findSlugCollisions,
}

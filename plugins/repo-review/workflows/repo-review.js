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
    { title: 'Detect', detail: 'per-repo flavor detection (when not given)' },
    { title: 'Reviews', detail: 'five lens reviewers per repo, one at a time' },
    { title: 'Synthesis', detail: 'reconcile (code) + write the memo' },
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

// parse the raw arg string into { repos, profile, specialization }.
// `--profile <name>` sets the profile; `--for <text>` adds free-text
// specialization (quote multi-word values); other non-flag tokens are repos.
function parseArgs(argstr) {
  const tokens = tokenize(String(argstr == null ? '' : argstr))
  const repos = []
  let profile = null
  let specialization = null
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === '--profile' || t === '--for') {
      const next = tokens[i + 1]
      const val = next && !next.startsWith('--') ? tokens[++i] : null
      if (t === '--profile') profile = val || profile
      else specialization = val || specialization
    } else if (t.startsWith('--profile=')) {
      profile = t.slice('--profile='.length) || profile
    } else if (t.startsWith('--for=')) {
      specialization = t.slice('--for='.length) || specialization
    } else if (t.startsWith('--')) {
      // unknown flag - ignore
    } else {
      repos.push(splitRepoToken(t))
    }
  }
  return { repos, profile, specialization }
}

// normalize whatever the command passes - a raw string or a structured object
// - into { repos: [{path, flavor}], profile }. strings go through parseArgs;
// objects are validated/coerced and unknown flavors dropped to null.
function normalizeArgs(args) {
  if (typeof args === 'string' || args == null) {
    return parseArgs(args == null ? '' : args)
  }
  const profile = typeof args.profile === 'string' ? args.profile : null
  const specialization =
    typeof args.specialization === 'string' ? args.specialization : null
  const list = Array.isArray(args.repos) ? args.repos : []
  const repos = list
    .map(r => {
      if (typeof r === 'string') return splitRepoToken(r)
      const path = r && typeof r.path === 'string' ? r.path : ''
      const flavor = r && KNOWN_FLAVORS.includes(r.flavor) ? r.flavor : null
      return { path, flavor }
    })
    .filter(r => r.path)
  return { repos, profile, specialization }
}

// the world of allowed profiles. a profile sets WHO is judging and the verdict
// scale; flavor (what the repo is for) is orthogonal. framing text per profile
// is added at the prompt-building step.
const PROFILES = {
  general: {
    label: 'general code-quality review',
    audience: 'a senior engineer doing a neutral code-quality review',
    bar: 'a solid professional engineering standard',
    purpose:
      'judge the repo on its own terms as software, with no specific ' +
      'downstream use assumed',
    verdicts: ['Excellent', 'Good', 'Fair', 'Poor'],
  },
  job: {
    label: 'job-application portfolio piece',
    audience:
      'a hiring committee evaluating this repo as a candidate portfolio ' +
      'piece',
    bar: 'a strong professional hiring bar, calibrated to the role',
    purpose:
      'judge whether this repo, as one portfolio artifact, is a positive ' +
      'hiring signal for the stated role',
    verdicts: ['Strong Hire', 'Hire', 'Lean Hire', 'Lean No-Hire', 'No-Hire'],
  },
  'oss-audit': {
    label: 'open-source health / adoptability',
    audience: 'a team deciding whether to adopt or depend on this project',
    bar: 'the bar for taking on an external dependency in production',
    purpose:
      'judge the health, maintainability, and adoptability of this ' +
      'project as a dependency',
    verdicts: ['Adopt', 'Use with care', 'Avoid'],
  },
  'student-project': {
    label: 'student learning project',
    audience: 'an instructor grading a student learning project',
    bar:
      'a gentler bar for a learning exercise, weighting understanding and ' +
      'correctness over production polish',
    purpose:
      'judge what the work demonstrates about the learning and grasp of ' +
      'the problem',
    verdicts: ['A', 'B', 'C', 'D', 'F'],
  },
}
const DEFAULT_PROFILE = 'general'

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

// per-flavor modulation: how a repo's intended use tunes lens expectations.
// null means no specific use given -> balanced, general expectations.
const FLAVOR_GUIDANCE = {
  performance:
    'High-performance project: hold performance claims to a high bar - ' +
    'require benchmarks with warmup, repeated trials, variance/error bars, ' +
    'fixed reported hardware, and fair baselines; a missing benchmark ' +
    'harness is a real gap.',
  research:
    'Research artifact: judge computational efficiency and soundness as ' +
    'research, not product-grade throughput. Paper-substantiated efficiency ' +
    'claims are acceptable; do not require an in-repo benchmark harness or ' +
    'on-machine reproduction of headline numbers. Penalize unsupported or ' +
    'sloppy claims, not the mere absence of production benchmarking.',
  production:
    'Built for widespread/production use: weight engineering maturity, ' +
    'documentation, reliability, and API stability heavily; novelty ' +
    'matters less here.',
  personal:
    'Small/personal project: relax engineering-maturity expectations (CI, ' +
    'packaging, exhaustive tests); focus on whether it does its job ' +
    'clearly, and do not penalize the absence of production infrastructure.',
}
const BALANCED_GUIDANCE =
  'No specific intended use was given: judge with balanced, general ' +
  'expectations - neither demanding production infrastructure nor excusing ' +
  'its absence.'

// describe how a flavor tunes expectations (null/unknown -> balanced default).
function describeFlavor(flavor) {
  return (flavor && FLAVOR_GUIDANCE[flavor]) || BALANCED_GUIDANCE
}

// filesystem-safe short name from a repo path, for temp dirs and output files.
function repoSlug(path) {
  const trimmed = String(path || '').replace(/[/\\]+$/, '')
  const base = trimmed.split(/[/\\]/).pop()
  if (!base || base === '.' || base === '..') return 'repo'
  return base.replace(/[^A-Za-z0-9_.-]/g, '-') || 'repo'
}
// <<< pure

// where per-lens reviews and memos are written (outside the temp clones, which
// get deleted). TODO: make overridable via args.
const OUTDIR = 'repo-review-out'

// ---- lenses (CORE) -------------------------------------------------------
const LENSES = [
  {
    key: 'performance',
    title: 'Performance & benchmarking rigor',
    focus:
      'Is the work efficient for what it does? Actually profile the code ' +
      'yourself (e.g. cProfile or pprofile for Python, or a profiler ' +
      'appropriate to the stack) to locate hot spots - do not just trust ' +
      'claims. Scrutinize benchmarking methodology: warmup, repeated ' +
      'trials, variance/error bars, fixed and reported hardware, fair ' +
      'baselines. Are performance claims backed by evidence or merely ' +
      'asserted? Is there a credible baseline (naive impl or an established ' +
      'library)? Does it scale (problem size, threads/cores, GPU if ' +
      'claimed)? Where feasible, reproduce a headline number and report ' +
      'what you measured.',
  },
  {
    key: 'correctness',
    title: 'Correctness & validity',
    focus:
      'Does the code actually compute what it claims? Look for validation ' +
      'against analytic results, reference implementations, or known values. ' +
      'Check numerical accuracy, stability, overflow, and edge cases. ' +
      'Independently verify some outputs where feasible. Are there silent ' +
      'correctness assumptions? Does the test suite exercise the hot paths ' +
      'and the headline claims, or only trivial cases? Identify additional ' +
      'ways the code could be tested or validated (properties, invariants, ' +
      'reference cross-checks, harder inputs) and suggest them to the ' +
      'reader.',
  },
  {
    key: 'engineering',
    title: 'Engineering maturity',
    focus:
      'Assess "shipped" quality: packaging/installability, dependency ' +
      'pinning, versioning, error handling, typing, and CI (does it run ' +
      'per-push/PR or not at all?). Test coverage of the important paths, ' +
      'license consistency, and git-history legibility. Reproducibility: ' +
      'seeds, deterministic configs, environment capture - can the headline ' +
      'results be reproduced from the repo as shipped? The code should also ' +
      'be readable and concise: flag long code that is not crucial to ' +
      'function or performance and recommend removing it. Note ' +
      'contradictions (license, version/tag drift, dead code).',
  },
  {
    key: 'taste',
    title: 'Taste & positioning',
    focus:
      'Is the problem worth solving, and is the work well-positioned? Is ' +
      'prior art and existing tooling acknowledged, and is the work honest ' +
      'about how it compares to real alternatives? Is the chosen approach ' +
      'the right tool for the job? Is the scope well-judged (focused and ' +
      'finished vs. sprawling or toy)? Penalize rebuilding a solved, ' +
      'readily-available thing with no reason to. Does it show genuine ' +
      'judgment and domain understanding?',
  },
  {
    key: 'documentation',
    title: 'Documentation & onboarding UX',
    focus:
      'Judge the README and docs as a cold drop-in newcomer. The README is ' +
      'best when MINIMAL and laser-focused on getting a newcomer from zero ' +
      'to running: what it is, installation, and a first working example. ' +
      'Prefer a graphic or short demo (screenshot/gif) where it helps. ' +
      'Reward low time-to-first-success and low friction; deeper API or ' +
      'theory docs can live beyond the README. Beyond that focus, do not ' +
      'nitpick formatting or favor a particular style - judge fitness for ' +
      'the newcomer, not adherence to a format you prefer. (Calibration of ' +
      'claims is scored separately on the honesty axis.)',
  },
]

// ---- schemas (TODO: flesh out fields) ------------------------------------
const SCORE_PROPS = Object.fromEntries(
  SCORE_AXES.map(a => [a, { type: 'number', minimum: 1, maximum: 10 }]),
)
const DETECT_SCHEMA = {
  type: 'object',
  required: ['flavor'],
  properties: {
    flavor: { type: 'string', enum: KNOWN_FLAVORS },
    rationale: { type: 'string' },
  },
}
// built per-run so `recommendation` validates against the profile's verdicts.
function buildReviewSchema(profile) {
  return {
    type: 'object',
    required: ['reviewedCommit', 'scores', 'recommendation', 'review'],
    properties: {
      reviewedCommit: { type: 'string', description: 'commit reviewed' },
      scores: { type: 'object', required: SCORE_AXES, properties: SCORE_PROPS },
      scoreJustifications: { type: 'object', description: 'one line per axis' },
      recommendation: { type: 'string', enum: profile.verdicts },
      strengths: { type: 'array', items: { type: 'string' } },
      weaknesses: { type: 'array', items: { type: 'string' } },
      testsWritten: { type: 'string', description: 'tests you wrote + results' },
      oversellAssessment: { type: 'string' },
      review: { type: 'string', description: 'full per-lens review markdown' },
      cleanupConfirmed: { type: 'boolean' },
    },
  }
}
const SYNTHESIS_SCHEMA = {
  type: 'object',
  required: ['memo', 'verdict'],
  properties: {
    memo: { type: 'string', description: 'consolidated memo markdown doc' },
    verdict: { type: 'string' },
    outliers: { type: 'array', items: { type: 'string' } },
  },
}

// ---- prompt builders (TODO: flesh out the actual prompt content) ---------
function detectPrompt(repo) {
  return `TODO: inspect ${repo.path} and classify its flavor ` +
    `(one of: ${KNOWN_FLAVORS.join(', ')}).`
}
function reviewPrompt(repo, lens, profile, flavor) {
  const slug = repoSlug(repo.path)
  const tmp = `/tmp/rr-${slug}-${lens.key}`
  const outPath = `${OUTDIR}/${slug}/${lens.key}.md`
  const verdicts = profile.verdicts.join(', ')
  return [
    `You are ${profile.audience}. You are reviewing the repository at ` +
      `\`${repo.path}\`, and your job is to ${profile.purpose}. Judge it ` +
      `against ${profile.bar}.`,
    `Repo intent (flavor): ${describeFlavor(flavor)}`,
    `YOUR LENS - weight this heavily, on top of a full review: ` +
      `${lens.title}.\n${lens.focus}`,
    'You are dropped in COLD, like a real reviewer who just found this ' +
      'repo. Read the README, form honest first impressions, then get ' +
      'hands-on.',
    'SET UP YOUR OWN ISOLATED COPY (ease of standup is part of the ' +
      'review):\n' +
      '1. Clone only committed code into a fresh temp dir you own:\n' +
      `   rm -rf ${tmp} && git clone ${repo.path} ${tmp}\n` +
      '   (if not a git repo, copy the tree and strip build ' +
      'artifacts/venvs). Work inside it; never modify the original at ' +
      `${repo.path}. Record the exact commit: git -C ${tmp} rev-parse ` +
      'HEAD.\n' +
      '2. Build/install from scratch per the README, in an isolated env ' +
      '(e.g. a venv inside the temp dir). Record every step, error, and ' +
      'workaround - setup friction is a real finding.\n' +
      '3. Actually RUN a demo/example and observe real output.',
    'BE HANDS-ON - THIS IS THE POINT. You have a private clone; use it:\n' +
      '- Run ANY code you want. Reproduce the headline claims and stress ' +
      'them.\n' +
      '- WRITE YOUR OWN TESTS. Author new test cases / scripts in your ' +
      'clone and run them to independently verify behavior, correctness, ' +
      'and (where relevant) performance - go BEYOND the tests the repo ' +
      'ships. This is required, not optional. Report what you wrote and ' +
      'what it showed.\n' +
      '- For performance, actually PROFILE the code yourself ' +
      '(cProfile/pprofile for Python, or a profiler appropriate to the ' +
      'stack) to find where time goes - do not take claims on faith.\n' +
      '- Note additional validation/tests the authors should add.',
    'MACHINE IS RAM-LIMITED: before any heavy build/run, check available ' +
      'memory (e.g. free -m). If memory is tight or an op risks an OOM ' +
      'kill, downgrade that step to a read-only assessment and say so - ' +
      'never risk OOM.',
    'EVIDENCE & ATTRIBUTION: for any defect or claim, cite the exact ' +
      'file:line in the repo and quote the offending text. Never attribute ' +
      'to the repo anything that came from THESE instructions (the example ' +
      'paths/commands above are NOT the words of the repo) - verify every ' +
      'detail against the actual repo files.',
    'SCORE ALL SEVEN AXES (1-10, one-line justification each; do not ' +
      `inflate; calibrate to ${profile.bar}): performance, correctness, ` +
      'engineering, taste, documentation, honesty (is the repo ' +
      'over/underclaiming?), overall.',
    `Also give a RECOMMENDATION for this lens, one of: ${verdicts}.`,
    `WRITE THE REVIEW DOC: save a full markdown review to ${outPath} ` +
      '(first line: the reviewed commit hash). Cover: first impressions; ' +
      'install & run experience; the tests you wrote and what they showed; ' +
      'your special-lens deep dive; per-axis scores + justifications; ' +
      'strengths; weaknesses/red flags; overselling-vs-underselling; ' +
      'cleanup confirmation. This doc is the human-readable deliverable.',
    `CLEAN UP COMPLETELY: rm ${tmp} and remove anything installed ` +
      'system-wide; leave no trace. Confirm cleanup.',
    'Return your result via the structured-output tool, populating every ' +
      'field.',
  ].join('\n\n')
}
function synthesisPrompt(repo, profile, flavor, reviews, scores) {
  return `TODO: synthesize ${reviews.length} reviews of ${repo.path} into a ` +
    `${profile.label} memo. Use the precomputed reconciled scores (do not ` +
    `recompute); identify outliers; write the memo doc.`
}

// ---- orchestration -------------------------------------------------------
// Fully SEQUENTIAL by design: repos one at a time, and the five lens reviewers
// one at a time within each. Only one clone/build/run is ever active, so
// profiling/benchmarks are uncontended and RAM stays bounded.
const { repos, profile: profileName, specialization } = normalizeArgs(args)
const profile = resolveProfile(profileName, specialization)
if (!repos.length) return { error: 'no repositories given', profile: profile.name }
const reviewSchema = buildReviewSchema(profile)
log(`repo-review: ${repos.length} repo(s), profile ${profile.name}`)

const results = []
for (const repo of repos) {
  // resolve flavor: detect only when not given inline
  let flavor = repo.flavor
  if (!flavor) {
    const d = await agent(detectPrompt(repo), {
      label: `detect:${repo.path}`, phase: 'Detect', schema: DETECT_SCHEMA,
    })
    flavor = (d && d.flavor) || null
  }

  // five lens reviewers, strictly one at a time
  const reviews = []
  for (const lens of LENSES) {
    log(`review ${repo.path} :: ${lens.title}`)
    const r = await agent(reviewPrompt(repo, lens, profile, flavor), {
      label: `review:${repo.path}:${lens.key}`,
      phase: 'Reviews', schema: reviewSchema,
    })
    if (r) reviews.push({ ...r, lens: lens.key })
  }

  const scores = reconcileScores(reviews)

  // synthesis narrates + identifies outliers + writes the memo; it does NOT
  // recompute the scores (those come from reconcileScores above)
  const synthesis = await agent(
    synthesisPrompt(repo, profile, flavor, reviews, scores),
    {
      label: `synthesis:${repo.path}`,
      phase: 'Synthesis',
      schema: SYNTHESIS_SCHEMA,
    },
  )

  results.push({ repo: repo.path, flavor, scores, synthesis })
}

return { profile: profile.name, repos: results }

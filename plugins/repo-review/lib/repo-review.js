// repo-review - clone + build + run a repo, review across five lenses, synthesize
//
// design: CORE lenses + clone/build/run, with a swappable PROFILE overlay

export const meta = {
  name: 'repo-review',
  description:
    'Clone, build, run, and review repos across five lenses; synthesize.',
  whenToUse:
    'Stand repos up and review them; pass repo paths (optionally path:flavor).',
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

// parse the raw arg string into { repos, profile, specialization, outDir }.
// `--profile <name>` sets the profile; `--for <text>` adds free-text
// specialization; `--out <abs>` sets the absolute output base (quote
// multi-word values); other non-flag tokens are repos.
function parseArgs(argstr) {
  const tokens = tokenize(String(argstr == null ? '' : argstr))
  const repos = []
  let profile = null
  let specialization = null
  let outDir = null
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === '--profile' || t === '--for' || t === '--out') {
      const next = tokens[i + 1]
      const val = next && !next.startsWith('--') ? tokens[++i] : null
      if (t === '--profile') profile = val || profile
      else if (t === '--for') specialization = val || specialization
      else outDir = val || outDir
    } else if (t.startsWith('--profile=')) {
      profile = t.slice('--profile='.length) || profile
    } else if (t.startsWith('--for=')) {
      specialization = t.slice('--for='.length) || specialization
    } else if (t.startsWith('--out=')) {
      outDir = t.slice('--out='.length) || outDir
    } else if (t.startsWith('--')) {
      // unknown flag - ignore
    } else {
      repos.push(splitRepoToken(t))
    }
  }
  return { repos, profile, specialization, outDir }
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
  const outDir = typeof args.outDir === 'string' ? args.outDir : null
  const list = Array.isArray(args.repos) ? args.repos : []
  const repos = list
    .map(r => {
      if (typeof r === 'string') return splitRepoToken(r)
      const path = r && typeof r.path === 'string' ? r.path : ''
      const flavor = r && KNOWN_FLAVORS.includes(r.flavor) ? r.flavor : null
      return { path, flavor }
    })
    .filter(r => r.path)
  return { repos, profile, specialization, outDir }
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

// fallback output base, used only when the command passes no --out: per-lens
// reviews and memos are written here (outside the temp clones, which get
// deleted). normally the command passes an absolute --out, so the run uses
// outBase = outDir || OUTDIR.
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

// ---- schemas (built per-run; recommendation/verdict use profile.verdicts) -
const SCORE_PROPS = Object.fromEntries(
  SCORE_AXES.map(a => [a, { type: 'number', minimum: 1, maximum: 10 }]),
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

// ---- prompt builders -----------------------------------------------------
function detectPrompt(repo) {
  return [
    `You are classifying the INTENT of the repository at \`${repo.path}\` - ` +
      'what it is FOR - so a downstream review can calibrate its ' +
      'expectations. This is a quick, READ-ONLY inspection: do NOT build or ' +
      'run anything.',
    'Read the README, package manifests, any benchmarks/ or tests/ dirs, CI ' +
      'config, and skim the code and its scale. Then classify into exactly ' +
      'one flavor:\n' +
      '- performance: speed/efficiency is a headline goal (benchmarks, ' +
      'optimization focus, perf claims).\n' +
      '- research: a research artifact (e.g. paper-associated code) where ' +
      'soundness and efficiency matter more than product-grade throughput.\n' +
      '- production: built for widespread/production use - a library, ' +
      'service, or tool meant for others to depend on.\n' +
      '- personal: a small or personal project (scripts, experiments, ' +
      'learning).',
    'If the repo genuinely fits none, or the signal is mixed/unclear, return ' +
      'flavor = null and the review will use balanced expectations. Give a ' +
      'one-line rationale citing what you saw (file names, README lines).',
  ].join('\n\n')
}
function reviewPrompt(repo, lens, profile, flavor, outBase) {
  const slug = repoSlug(repo.path)
  const tmp = `/tmp/rr-${slug}-${lens.key}`
  const outPath = `${outBase}/${slug}/${lens.key}.md`
  const verdicts = profile.verdicts.join(', ')
  // profiling is core to the performance lens (and engineering, for repro);
  // for the other lenses it is optional - encouraged where it sharpens their
  // angle, but they should not feel obligated to profile.
  const mustProfile = lens.key === 'performance' || lens.key === 'engineering'
  const profileLine = mustProfile
    ? '- PROFILE the code yourself (cProfile/pprofile for Python, or a ' +
      'profiler appropriate to the stack) to find where time actually ' +
      'goes - expected for your lens; do not take perf claims on faith.'
    : '- You are free to profile if it would sharpen your lens, but it is ' +
      'not required - do not profile out of obligation; spend effort where ' +
      'your lens pays off.'
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
      profileLine + '\n' +
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
      '(write to this exact path - do NOT make it relative to your temp ' +
      'clone). First line: the reviewed commit hash. Cover: first impressions; ' +
      'install & run experience; the tests you wrote and what they showed; ' +
      'your special-lens deep dive; per-axis scores + justifications; ' +
      'strengths; weaknesses/red flags; overselling-vs-underselling; ' +
      'cleanup confirmation. This doc is the human-readable deliverable.',
    `CLEAN UP COMPLETELY: rm ${tmp} and remove anything installed ` +
      'system-wide; leave no trace. Confirm cleanup.',
    `In your structured output, set reviewPath to ${outPath} and give a ` +
      'ONE-LINE summary; populate scores, recommendation, and the other ' +
      'fields. Do NOT return the full review text in the output - it lives ' +
      'in the doc you wrote.',
  ].join('\n\n')
}
function synthesisPrompt(repo, profile, flavor, reviews, scores, outBase) {
  const slug = repoSlug(repo.path)
  const memoPath = `${outBase}/${slug}/MEMO.md`
  const verdicts = profile.verdicts.join(', ')
  const compact = reviews.map(r => ({
    lens: r.lens,
    scores: r.scores,
    recommendation: r.recommendation,
    strengths: r.strengths,
    weaknesses: r.weaknesses,
    oversellAssessment: r.oversellAssessment,
    testsWritten: r.testsWritten,
    reviewedCommit: r.reviewedCommit,
  }))
  return [
    `You are the synthesizing chair consolidating ${reviews.length} ` +
      `independent lens reviews of the repository ${repo.path}, evaluated ` +
      `as ${profile.label}. Your job is to ${profile.purpose}, judged ` +
      `against ${profile.bar}. Repo intent (flavor): ` +
      `${describeFlavor(flavor)}.`,
    'Synthesize from the reviews BELOW ONLY. Do NOT clone, open, build, or ' +
      'inspect the repository or any local files - your working directory ' +
      'may contain an unrelated project. Base every statement on the ' +
      'structured reviews.',
    'PROVENANCE - the reviewers each recorded the commit they reviewed; ' +
      'these may not agree. Determine provenance from their reviewedCommit ' +
      'fields:\n' +
      '- all the same hash  -> report that single hash.\n' +
      '- they differ        -> report each hash and FLAG it: the repo may ' +
      'have changed mid-run, so scores are not strictly comparable.\n' +
      '- "non-git snapshot" -> report "non-git snapshot" (no commit).',
    'The per-axis scores are ALREADY reconciled in code (lens-weighted). ' +
      'Use these numbers verbatim - do NOT recompute or re-average:\n' +
      JSON.stringify(scores, null, 2),
    `The ${reviews.length} lens reviews (lens, scores, recommendation, ` +
      'strengths, weaknesses, oversell assessment, tests written, ' +
      'reviewedCommit):\n' +
      JSON.stringify(compact, null, 2),
    'Produce one consolidated memo:\n' +
      `- VERDICT: one of ${verdicts}.\n` +
      '- OUTLIERS (required): for any axis where a reviewer diverges ' +
      'materially from the others (see the ranges), name the reviewer, the ' +
      'axis, and why - misread, lens bias, or a real signal others missed? ' +
      'Do not skip this.\n' +
      '- DISAGREEMENTS: genuine substantive disagreements worth surfacing.\n' +
      '- CONSENSUS strengths and weaknesses: items multiple reviewers ' +
      'independently flagged, or that are clearly material.\n' +
      '- OVERSELL/UNDERSELL: an explicit calibration call (drawing on the ' +
      'honesty axis and the oversell assessments).\n' +
      '- FIXES: a prioritized, actionable punch-list; tag each with impact ' +
      `(what ${profile.audience} sees) and effort (minutes / hours / >1 ` +
      'day).',
    `WRITE THE MEMO DOC: save the full markdown memo to ${memoPath}, ` +
      'opening with the provenance line (per the rules above), then: a ' +
      'one-paragraph verdict; a per-axis reconciled-score table with ranges; ' +
      'consensus strengths; consensus weaknesses/red flags; outliers; ' +
      'disagreements; the oversell/undersell call; the Fixes section; and ' +
      'the final recommendation tied to the purpose. This memo is the ' +
      'human-readable deliverable.',
    `In your structured output, set memoPath to ${memoPath} and give a ` +
      'SHORT summary (2-4 sentences: the verdict and why); populate verdict, ' +
      'provenance, outliers, disagreements, consensus lists, and fixes. Do ' +
      'NOT return the full memo text in the output - it lives in the doc you ' +
      'wrote.',
  ].join('\n\n')
}

// ---- orchestration -------------------------------------------------------
// Fully SEQUENTIAL by design: repos one at a time, and the five lens reviewers
// one at a time within each. Only one clone/build/run is ever active, so
// profiling/benchmarks are uncontended and RAM stays bounded.
const { repos, profile: profileName, specialization, outDir } =
  normalizeArgs(args)
const profile = resolveProfile(profileName, specialization)
if (!repos.length) return { error: 'no repositories given', profile: profile.name }
// absolute output base passed by the command (--out <pwd>/repo-review-out) so
// docs land deterministically at the invocation dir regardless of where lens
// agents cd to; falls back to the relative default for direct invocation.
const outBase = outDir || OUTDIR
const reviewSchema = buildReviewSchema(profile)
const synthesisSchema = buildSynthesisSchema(profile)
log(`repo-review: ${repos.length} repo(s), profile ${profile.name}, ` +
  `output -> ${outBase}`)
log(
  `heads-up - thorough, token-heavy run: every lens clones, builds, runs ` +
  `the code and writes its own tests over a long session. expect very ` +
  `roughly ~15-20M tokens (mostly cache reads), ~100k output, ~1-2h per ` +
  `repo. on metered API that is ~$40-60/repo (Opus), but a Claude ` +
  `subscription subsidizes this heavily - it runs easily on a $100/mo plan. ` +
  `interrupt now if unintended.`
)

const results = []
let n = 0
for (const repo of repos) {
  n++
  const tag = `[${n}/${repos.length}] ${repo.path}`
  log(`${tag}: starting`)

  // resolve flavor: detect only when not given inline
  let flavor = repo.flavor
  if (!flavor) {
    log(`${tag}: detect - classifying flavor`)
    const d = await agent(detectPrompt(repo), {
      label: `detect:${repo.path}`, phase: 'Detect', schema: DETECT_SCHEMA,
    })
    flavor = (d && d.flavor) || null
    log(`${tag}: detect done - flavor ${flavor || 'balanced'}`)
  } else {
    log(`${tag}: flavor ${flavor} (given)`)
  }

  // five lens reviewers, strictly one at a time
  log(`${tag}: reviews - ${LENSES.length} lenses, one at a time`)
  const reviews = []
  for (const lens of LENSES) {
    log(`${tag}: review start - ${lens.title}`)
    const r = await agent(reviewPrompt(repo, lens, profile, flavor, outBase), {
      label: `review:${repo.path}:${lens.key}`,
      phase: 'Reviews', schema: reviewSchema,
    })
    if (r) {
      reviews.push({ ...r, lens: lens.key })
      const ov = r.scores ? r.scores.overall : '?'
      log(`${tag}: review done - ${lens.title}: overall ${ov}, ` +
        `${r.recommendation} - ${r.summary || ''}`)
    } else {
      log(`${tag}: review FAILED - ${lens.title}`)
    }
  }

  const scores = reconcileScores(reviews)
  log(`${tag}: reconciled ${reviews.length}/${LENSES.length} - overall ` +
    `${scores.reconciled.overall}`)

  // synthesis narrates + identifies outliers + writes the memo; it does NOT
  // recompute the scores (those come from reconcileScores above)
  log(`${tag}: synthesis - writing memo`)
  const synthesis = await agent(
    synthesisPrompt(repo, profile, flavor, reviews, scores, outBase),
    {
      label: `synthesis:${repo.path}`,
      phase: 'Synthesis',
      schema: synthesisSchema,
    },
  )
  if (synthesis) {
    const cs = (synthesis.consensusStrengths || []).length
    const cw = (synthesis.consensusWeaknesses || []).length
    const ol = (synthesis.outliers || []).length
    log(`${tag}: VERDICT ${synthesis.verdict} (overall ` +
      `${scores.reconciled.overall})\n  ${synthesis.summary || ''}\n  ` +
      `consensus: +${cs} / -${cw}; ${ol} outliers; ` +
      `memo -> ${synthesis.memoPath || '(unwritten)'}`)
  } else {
    log(`${tag}: synthesis FAILED`)
  }

  results.push({ repo: repo.path, flavor, scores, synthesis })
}

log(`repo-review: finished ${results.length}/${repos.length} repo(s)`)
for (const res of results) {
  const v = res.synthesis ? res.synthesis.verdict : '(synthesis failed)'
  log(`  ${res.repo}: ${v} (overall ${res.scores.reconciled.overall})`)
}

return { profile: profile.name, repos: results }

// generated from util/content/engine.mjs by adapters/claude/build.mjs
// do not edit by hand - edit the .mjs sources
// pure path helpers shared by the engine and prompt builders. no deps, no
// side effects - safe to import anywhere

// filesystem-safe short name from a repo path, for temp dirs and output files
function repoSlug(path) {
  const trimmed = String(path || '').replace(/[/\\]+$/, '')
  const base = trimmed.split(/[/\\]/).pop()
  if (!base || base === '.' || base === '..') return 'repo'
  return base.replace(/[^A-Za-z0-9_.-]/g, '-') || 'repo'
}

// per-repo output dir <outBase>/<slug>, with an optional run stamp nested
// beneath so re-runs don't clobber earlier ones. sanitize the stamp like a slug
function repoOutDir(outBase, slug, stamp) {
  const dir = `${outBase}/${slug}`
  return stamp ? `${dir}/${repoSlug(stamp)}` : dir
}

// review content: the prompt text and tuning tables (profiles, lenses,
// hands-on mandates, flavor guidance). edit here to change what a review says
// or asks; the mechanical plumbing lives in engine.mjs, pure helpers in
// util.mjs

// profiles
// --------
// the world of allowed profiles. a profile sets who is judging and the verdict
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

// flavor guidance
// ---------------
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

// lenses (core)
// -------------
const LENSES = [
  {
    key: 'performance',
    title: 'Performance & efficiency',
    focus:
      'Is the work efficient for what it does - judged on the terms that ' +
      'matter for THIS repo, not one fixed checklist. First decide what ' +
      'performance means here and measure that: run time, memory, and ' +
      'scaling for compute or numeric code; throughput and latency for a ' +
      'service; startup and I/O for a CLI; time, memory, and (where ' +
      'applicable) token/API cost for a tool that drives external work. ' +
      'Profile it yourself with a tool fit for the stack to find where ' +
      'time and resources actually go - do not just trust claims. Hold it ' +
      'to rigorous benchmarking (warmup, repeated trials, variance/error ' +
      'bars, fixed reported hardware, fair baselines) where speed or ' +
      'efficiency is a headline claim; where it is not, judge whether the ' +
      'work is reasonably efficient for its purpose rather than demanding ' +
      'a benchmark harness it never needed. Back any efficiency claim with ' +
      'a credible baseline and reproduce a headline number where feasible.',
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
      'contradictions (license, version/tag drift, dead code). Also run a ' +
      'light, non-authoritative security pass: flag obvious red flags that ' +
      'surface in ordinary review - secrets or credentials committed to the ' +
      'repo, command/SQL injection, unsafe eval or deserialization, path ' +
      'traversal, or dependencies with known-serious CVEs. State plainly ' +
      'that this is NOT an authoritative security audit and is not a clean ' +
      'bill of health; keep it secondary to the maturity assessment.',
  },
  {
    key: 'taste',
    title: 'Taste, positioning & the adversarial case',
    focus:
      'Two jobs. FIRST, taste and positioning: is the problem worth ' +
      'solving, is prior art and existing tooling acknowledged, and is the ' +
      'work honest about how it compares to real alternatives? Is the scope ' +
      'well-judged (focused and finished vs. sprawling or toy)? Penalize ' +
      'rebuilding a solved, readily-available thing with no reason to; ' +
      'reward genuine judgment and domain understanding. SECOND, be the ' +
      'skeptic: make the strongest honest case for REJECTING this artifact. ' +
      'Assume the reader believes the README at face value, then show where ' +
      'reality falls short - missing deliverables, overstated results, gaps ' +
      'between the pitch and the code. Do not manufacture flaws, but do not ' +
      'extend charity the evidence does not support.',
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
      'the newcomer, not adherence to a format you prefer. Also assess ' +
      'authorial voice: does the prose read like a human who did the work, ' +
      'or like generic AI-generated filler? Flag telltale LLM slop - hollow ' +
      'superlatives (seamless, robust, powerful, comprehensive), formulaic ' +
      "hedging, \"it's worth noting\", the \"not just X, but Y\" " +
      'construction, wall-to-wall bullets and bold, and emoji-studded ' +
      'headers that add no information. Reward concrete, specific, voice-y ' +
      'writing. Judge the writing, not the tool: AI assistance is fine - ' +
      'penalize only pervasive, low-information AI-slop phrasing, not ' +
      'honest polish. (Calibration of claims is scored separately on the ' +
      'honesty axis.)',
  },
]

// hands-on mandates
// -----------------
// per-lens hands-on mandate: the deep, expensive probing each lens should do,
// scoped to its axis. directs effort (and cost) where the lens pays off, and
// stops every lens re-deriving the same correctness/perf findings. spliced
// into the shared hands-on block by reviewPrompt.
const HANDS_ON = {
  correctness:
    '- TESTING IS YOUR MAIN HANDS-ON WORK: write your own tests - ' +
    'property/invariant checks, reference or oracle cross-checks, edge ' +
    'cases, and harder-than-shipped inputs - and run them to independently ' +
    'confirm or break the headline outputs. Go well beyond the shipped ' +
    'suite; report what you wrote and what it showed.',
  performance:
    '- PROFILE with a tool fit for the stack (cProfile/pprofile, a tracer, ' +
    'timers, or resource/token accounting where relevant) to see where ' +
    'time and resources actually go, and judge efficiency on what matters ' +
    'for THIS repo rather than one fixed metric. Scrutinize benchmark ' +
    'methodology (warmup, repeats, error bars, fixed hardware, fair ' +
    'baselines) where speed or efficiency is a headline claim; otherwise ' +
    'assess fitness-for-purpose. Write small perf probes where they ' +
    'sharpen the picture; do not author a broad correctness suite.',
  engineering:
    '- BUILD AND INSTALL FROM SCRATCH (record friction), run the shipped ' +
    'tests and any CI locally, and check reproducibility - seeds, configs, ' +
    'and whether headline results regenerate from the repo as shipped. A ' +
    'few targeted checks suffice; you need not author an extensive new test ' +
    'suite or profile in depth - leave those to the correctness and ' +
    'performance lenses. While you build and read, keep an eye out for ' +
    'obvious security problems (committed secrets, injection, unsafe ' +
    'eval/deserialization) and report any you hit - a non-exhaustive pass, ' +
    'explicitly not a full audit.',
  documentation:
    '- FOLLOW THE README AS A COLD DROP-IN: install and run the FIRST ' +
    'documented example exactly as written, noting how fast you reach a ' +
    'working result and where you snag - that standup experience is your ' +
    'evidence. Do NOT write oracle suites, profile, or stress-test; that ' +
    'is not your lens. Judge time-to-first-success and friction. As you ' +
    'read, also gauge whether the prose sounds human-authored or like ' +
    'generic AI boilerplate, and call out the specific slop phrases you ' +
    'find.',
  taste:
    '- USE THE INTERNET ACTIVELY: search the web for prior art, competing ' +
    'libraries, and the state of the art, and fetch pages to judge whether ' +
    'this work is novel or a redundant reimplementation; check the claims ' +
    'and citations against real sources. If web tools are unavailable, do ' +
    'NOT penalize the repo for unverified prior art or claims (that is a ' +
    'limit of THIS review, not a repo fault); record it in caveats and ' +
    'reason from what you know.\n' +
    '- BUILD THE REJECTION CASE: read the README and code and run a quick ' +
    'example to ground the read, then assemble the strongest honest ' +
    'argument against the artifact - claims vs. reality, scope, prior art. ' +
    'Do NOT author test suites or profile; leave that to the correctness ' +
    'and performance lenses.',
}

// prompt builders
// ---------------
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
function reviewPrompt(repo, lens, profile, flavor, outBase, stamp, date) {
  const slug = repoSlug(repo.path)
  const tmp = `/tmp/rr-${slug}-${lens.key}`
  const outPath = `${repoOutDir(outBase, slug, stamp)}/${lens.key}.md`
  const verdicts = profile.verdicts.join(', ')
  // each lens gets a hands-on mandate scoped to its axis (deep test-authoring
  // for correctness, profiling for performance, light/read-oriented for
  // documentation and taste) so the lenses do not all re-run the same checks.
  const handsOn = HANDS_ON[lens.key] || ''
  return [
    `You are ${profile.audience}. You are reviewing the repository at ` +
      `\`${repo.path}\`, and your job is to ${profile.purpose}. Judge it ` +
      `against ${profile.bar}.`,
    date && `Today's date is ${date}. Treat recent dates, versions, and ` +
      'citations as plausibly real - do NOT flag something as a future, ' +
      'erroneous, or fabricated date just because it postdates your ' +
      'knowledge/training cutoff; verify against the repo instead.',
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
    'BE HANDS-ON - you have a private clone; use it. Run the code to ground ' +
      'your review. Spend your hands-on effort where YOUR lens pays off ' +
      '(below) - do not re-run every other lens\'s deep checks; the lenses ' +
      'are independent on purpose, so a light pass outside your lens is ' +
      'fine, but do not duplicate their work.\n' +
      handsOn + '\n' +
      '- Note additional validation/tests the authors should add.',
    'MACHINE IS RAM-LIMITED: before any heavy build/run, check available ' +
      'memory (e.g. free -m). If memory is tight or an op risks an OOM ' +
      'kill, downgrade that step to a read-only assessment and say so - ' +
      'never risk OOM.',
    'CONTEXT DISCIPLINE: keep the working context lean - do NOT paste whole ' +
      'files or long command output into the conversation; sample, summarize, ' +
      'and truncate. prefer targeted reads over dumping or re-reading; a ' +
      'bloated context forces a mid-review summary that can drop this lens.',
    'TIME DISCIPLINE: every command gets an explicit, SMALL time limit - ' +
      'default 120 seconds (Bash tool timeout, or prefix `timeout 120`). ' +
      'Raising a bound must be deliberate: first prove the step at smoke ' +
      'scale, then rerun with a higher bound. NEVER launch unbounded ' +
      'compute - no ' +
      'uncapped searches or infinite node/iteration limits; size every ' +
      'probe to finish in minutes. Long runs must stream output unbuffered ' +
      '(python3 -u / flush=True) so partial progress is visible, and a ' +
      'background task with an empty output file is indistinguishable ' +
      'from a hung one - do not poll-wait on it; bound it and check the ' +
      'bound.',
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
      'fields. If any tool you needed (e.g. web search) was unavailable, ' +
      'list it in caveats and do NOT lower any score for your own missing ' +
      'tools. Do NOT return the full review text in the output - it lives ' +
      'in the doc you wrote.',
  ].filter(Boolean).join('\n\n')
}
function synthesisPrompt(repo, profile, flavor, reviews, scores, outBase, stamp, date) {
  const slug = repoSlug(repo.path)
  const memoPath = `${repoOutDir(outBase, slug, stamp)}/MEMO.md`
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
    caveats: r.caveats,
  }))
  return [
    `You are the synthesizing chair consolidating ${reviews.length} ` +
      `independent lens reviews of the repository ${repo.path}, evaluated ` +
      `as ${profile.label}. Your job is to ${profile.purpose}, judged ` +
      `against ${profile.bar}. Repo intent (flavor): ` +
      `${describeFlavor(flavor)}.`,
    date && `Today's date is ${date}. Treat recent dates, versions, and ` +
      'citations as plausibly real - do NOT flag anything as a future or ' +
      'fabricated date just because it postdates your knowledge cutoff.',
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
      '- CAVEATS (loud): if any reviewer reported caveats (e.g. web tools ' +
      'unavailable), state them prominently as limits of the REVIEW, never ' +
      'as repo faults, and do not let them lower the scores or verdict.\n' +
      '- FIXES: a prioritized, actionable punch-list; tag each with impact ' +
      `(what ${profile.audience} sees) and effort (minutes / hours / >1 ` +
      'day).',
    `WRITE THE MEMO DOC: save the full markdown memo to ${memoPath}, ` +
      'opening with a LOUD "> Review limitations" callout if any reviewer ' +
      'reported caveats (e.g. web tools unavailable), then the provenance ' +
      'line (per the rules above), then: a ' +
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
  ].filter(Boolean).join('\n\n')
}

// repo-review engine: argument parsing, profile resolution, score
// reconciliation, schema building, and the sequential orchestration loop. the
// prompt text and tuning tables live in content.mjs, pure helpers in util.mjs.
// adapters/claude/build.mjs inlines all three into the repo-review.js artifact

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

// Claude Code launcher: wire the runtime globals into the injected host.
const __host = {
  spawn: (prompt, opts) => agent(prompt, opts),
  log,
}
return run(__host, args)

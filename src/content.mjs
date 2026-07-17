// review content: the prompt text and tuning tables (profiles, lenses,
// hands-on mandates, flavor guidance). edit here to change what a review says
// or asks; the mechanical plumbing lives in engine.mjs, pure helpers in
// util.mjs
import { repoSlug, repoOutDir } from './util.mjs'

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

export {
  PROFILES, DEFAULT_PROFILE, LENSES, describeFlavor,
  detectPrompt, reviewPrompt, synthesisPrompt,
}

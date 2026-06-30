---
description: Clone, build, run, and review a repo across five lenses
argument-hint: <repo-path[:flavor]>... [--profile <name>] [--for <text>] [--out <dir>]
---

Review one or more code repositories by actually standing each up: clone,
build, run a demo, then judge across five lenses (performance, correctness,
engineering, taste & positioning, documentation) and synthesize a scored
review.

## Usage

```
/repo-review:review <repo>[:flavor] [--profile <name>] [--for <text>] [--out <dir>]
```

- **`<repo>[:flavor]`** - one or more repo paths (batch). `:flavor` pins how a
  repo is judged; omit it and the flavor is auto-detected. Flavors:
  `performance`, `research`, `production`, `personal`.
- **`--profile <name>`** - who is judging and the verdict scale, for the whole
  run (default `general`):
  - `general` - neutral senior-engineer code-quality review (Excellent/Good/Fair/Poor)
  - `job` - hiring committee judging it as a portfolio piece (Strong Hire ... No-Hire)
  - `oss-audit` - whether to adopt/depend on it (Adopt / Use with care / Avoid)
  - `student-project` - instructor grading a learning project (A-F)
- **`--for "<text>"`** - free-text specialization layered on the profile (quote
  multi-word values). Examples:
  - `--profile job --for "a Research Engineer role on a research team"`
  - `--profile job --for "a senior frontend role at a design-led startup"`
  - `--profile oss-audit --for "using this as a core production dependency"`
- **`--out <dir>`** - absolute base for the output docs (default
  `<invocation-dir>/repo-review-out`); each repo writes
  `<out>/<repo>/{<lens>.md, MEMO.md}`.

Examples:

```
/repo-review:review ./my-lib
/repo-review:review ./api:performance ./ui --profile job --for "a full-stack role"
/repo-review:review ~/code/foo --profile oss-audit --out ~/reviews
```

**If the arguments are `--help` or `-h` (or no repo path is given), print the
Usage section above and STOP - do not start a review.**

## Cost & expectations

This is **thorough and token-heavy by design**: every lens clones, builds, and
*runs* the code over a long independent session (the deeper lenses also write
and run their own tests). Budget very roughly **~10-20M tokens per repo**
(overwhelmingly cache reads from those long sessions), ~80-130k output tokens,
and **~30-90 minutes per repo**.

On **metered API pricing** that is ~30-50 USD per repo (Opus; scales with repo
size, complexity, and lens depth). On a **Claude subscription this is heavily
subsidized** - usage is included rather than billed per token, so a run like
this fits comfortably within a **100 USD/mo Claude Max plan** and can be run
there easily.
The cost is dominated by the per-lens code-running review itself, not by waste
- it is the price of the depth. Prefer overnight runs for multi-repo batches.

Pass the command arguments through to the workflow unchanged - it parses the
tokens itself (see Usage above). Do not pre-parse the repos or flags yourself.

## Run

**Confirm inputs and cost before launching.** This is an expensive,
long-running operation, so do NOT launch it silently. First summarize what will
run and flag any review-shaping fields the user left unspecified, with their
defaults:
- profile (default `general`; alternatives `job`, `oss-audit`,
  `student-project`) - sets the audience and verdict scale
- specialization via `--for` (default none) - e.g. a target role for `job`
- each repo's flavor (auto-detected unless pinned as `path:flavor`)

Ask whether the user wants to set any of these or proceed with the defaults.
Also state the estimated cost - roughly 30-90 minutes and 30-50 USD per repo on
metered API pricing (heavily subsidized on a Claude subscription; within a
100 USD/mo Max plan), scaled by the repo count. Only launch once the user
explicitly confirms; if they decline, stop without running. You may inspect the
arguments to see which flags are present, but pass them through unchanged - the
workflow does the real parsing.

**Preferred - Workflow orchestration.** If the Workflow tool is available (this
command invocation is your authorization), use it. First run `pwd` to capture
the absolute invocation directory, then append `--out "<pwd>/repo-review-out"`
to the arguments so review docs land deterministically there - not inside a
lens agent's temp clone (which gets deleted). Replace `<pwd>` with the actual
path and keep the quotes in case it contains spaces:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/lib/repo-review.js",
  args: "$ARGUMENTS --out \"<pwd>/repo-review-out\""
})
```

The workflow also accepts a structured object, so an agent invoking it
programmatically can skip the string entirely (pass `outDir` directly):

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/lib/repo-review.js",
  args: {
    repos: [{ path: "./a", flavor: "performance" }, { path: "./b" }],
    profile: "job",
    specialization: "a RE role at Anthropic",
    outDir: "<pwd>/repo-review-out"
  }
})
```

Both forms normalize to `{ repos, profile, specialization, outDir }`. If `outDir`
is omitted the output base falls back to a relative `repo-review-out`.

**Fallback** (no Workflow tool). The Workflow engine is only deterministic
orchestration - the reviewing is agent work, so reproduce the structure with
subagents.

If you can spawn subagents (Task/Agent tool): parse the arguments as the
workflow would. For each repo, ONE AT A TIME (keep profiling uncontended and
RAM bounded), spawn the five lens reviewers as separate subagents - each with
its lens brief: clone/build/run a fresh copy, WRITE AND RUN ITS OWN TESTS,
profile hot paths, score the seven axes 1-10, recommend on the profile's
verdict scale, and write its per-lens doc. Then reconcile the scores yourself
- lens-weighted: the owning lens counts double on its own axis; honesty and
overall are a plain mean - and write the memo (verdict, outliers,
disagreements, consensus, oversell/undersell call, fixes) to
`<pwd>/repo-review-out/<repo>/MEMO.md` - an absolute path anchored at the
invocation directory (`pwd`), and likewise the per-lens docs, so they survive
each reviewer's temp-clone cleanup.

If you cannot spawn subagents, do it inline as a single reviewer across the
five lenses - lower fidelity; note the reduced independence.

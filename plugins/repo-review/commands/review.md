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

**If `$ARGUMENTS` is `--help` or `-h` (or no repo path is given), print the
Usage section above and STOP - do not start a review.**

## Cost & expectations

This is **thorough and token-heavy by design**: every lens clones, builds, and
*runs* the code and writes its own tests over a long independent session.
Budget very roughly **~15-20M tokens per repo** (overwhelmingly cache reads
from those long sessions), ~100k output tokens, and **~1-2 hours per repo**.

On **metered API pricing** that is ~$40-60 per repo (Opus; scales with repo
size and lens count). On a **Claude subscription this is heavily subsidized** -
usage is included rather than billed per token, so a run like this fits
comfortably within a **$100/mo Claude Max plan** and can be run there easily.
The cost is dominated by the per-lens code-running review itself, not by waste
- it is the price of the depth. Prefer overnight runs for multi-repo batches.

Pass `$ARGUMENTS` through to the workflow unchanged - it parses the tokens
itself (see Usage above). Do not pre-parse the repos or flags yourself.

## Run

**Preferred - Workflow orchestration.** If the Workflow tool is available (this
command invocation is your authorization), use it. First run `pwd` to capture
the absolute invocation directory, then append `--out "<pwd>/repo-review-out"`
to the arguments so review docs land deterministically there - not inside a
lens agent's temp clone (which gets deleted). Replace `<pwd>` with the actual
path and keep the quotes in case it contains spaces:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/repo-review.js",
  args: "$ARGUMENTS --out \"<pwd>/repo-review-out\""
})
```

The workflow also accepts a structured object, so an agent invoking it
programmatically can skip the string entirely (pass `outDir` directly):

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/repo-review.js",
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

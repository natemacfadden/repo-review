---
description: Clone, build, run, and review a repo across five lenses
argument-hint: <repo-path[:flavor]>... [--profile <name>] [--for <text>] [--out <dir>]
---

**First, always print the plugin version and the argument contract.** Before
doing anything else - showing usage or launching - read `version` from
`${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` and print
`repo-review v<version>` as the first line of your response, so the running
build is always identifiable for debugging. Directly below it, print this
block verbatim (every run, not just on --help), so the argument surface is
on screen before anything can be mis-passed:

```
args:     <repo-path[:flavor]>... [--profile <name>] [--for "<text>"] [--out <abs-dir>]
flavors:  performance | research | production | personal   (omit = auto-detect)
profiles: general | job | oss-audit | student-project      (default: general)
```

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
  `<out>/<repo>/[<stamp>/]{<lens>.md, MEMO.md}`.
- **`--stamp <token>`** - a run-unique token (a timestamp) nested under each
  repo's dir so re-runs don't clobber earlier ones:
  `<out>/<repo>/<stamp>/...`. Normally supplied automatically by this command;
  omit it and docs land directly in `<out>/<repo>/`.
- **`--date <YYYY-MM-DD>`** - today's date, injected into the reviewer prompts
  (the engine can't read the clock) so agents don't flag recent dates, versions,
  or citations as "future" or fabricated. Normally supplied automatically by
  this command; omit it and reviewers get no current-date note.

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
and **~30 minutes to ~2 hours per repo**.

On **metered API pricing** that is ~30-50 USD per repo (Opus; scales with repo
size, complexity, and lens depth). On a **Claude subscription this is heavily
subsidized** - usage is included rather than billed per token, so a run like
this fits comfortably within a **100 USD/mo Claude Max plan** and can be run
there easily.
The cost is dominated by the per-lens code-running review itself, not by waste
- it is the price of the depth. Prefer overnight runs for multi-repo batches.

Pass the command arguments through to the workflow unchanged - it parses the
tokens itself (see Usage above). Do not pre-parse the repos or flags yourself.
The one exception is the pre-launch questions below: answers the user gives
there are folded into the argument string before launch.

## Run

**Confirm inputs and cost before launching.** This is an expensive,
long-running operation, so do NOT launch it silently. First summarize what will
run. Then, for every review-shaping field the user left unspecified, don't just
mention the default - ask about it, grounded in the repo itself. Take a quick
peek at each repo first (README, top-level listing - seconds of reading, no
build) so the questions are informed, then ask one round of questions via
AskUserQuestion (plain-text questions if that tool is unavailable):

- **flavor**, for each repo not pinned as `path:flavor`: offer the four
  flavors (`performance`, `research`, `production`, `personal`) plus
  auto-detect, recommending the one the peek suggests with a one-line reason
  (e.g. "benchmarks/ and a perf-focused README suggest `performance`"). For
  batches of more than 3 repos, ask once whether to pin flavors repo-by-repo
  or auto-detect the lot.
- **profile**, when `--profile` is absent: offer `general` (recommended
  default), `job`, `oss-audit`, `student-project`, each described in terms of
  this repo ("judge <name> as a hiring-committee portfolio piece", ...).
- **specialization**, when `--for` is absent: suggest 2-3 plausible values
  based on the peek and the chosen or likely profile (e.g. for `job` on an ML
  repo, "an ML research-engineer role"), plus "none". AskUserQuestion always
  appends an "Other" choice with a free-text field - for this question that
  free entry is the star, since the best `--for` is the user's own phrasing;
  word the question to invite it ("pick a suggestion, or describe your own
  under Other").

The point is to make setting these fields the easy path, not to gate the run:
every question carries a clearly-marked default, and a user who picks the
defaults gets exactly today's behavior (auto-detected flavors, `general`
profile, no specialization). Fold the answers back into the argument string -
pin chosen flavors as `path:flavor`, append `--profile <name>` and
`--for "<text>"` (keep the `--for` value quoted and on a single line; embedded
newlines break the tool-call serialization). Those answer-driven edits are the
ONLY changes you may make to the user's arguments.

Also state the estimated time and cost from the Cost & expectations section
above, scaled by the repo count. Only launch once the user
explicitly confirms (the confirmation may be the final question of the same
round); if they decline, stop without running. You may inspect the arguments
to see which flags are present, but beyond the answer-driven edits above pass
them through unchanged - the workflow does the real parsing.

**Preferred - Workflow orchestration.** If the Workflow tool is available (this
command invocation is your authorization), use it. First run
`pwd`, `date -u +%Y%m%dT%H%M%SZ`, and `date +%Y-%m-%d` to capture the absolute
invocation directory, a run timestamp, and today's date, then append
`--out "<pwd>/repo-review-out"`, `--stamp <timestamp>`, and `--date <date>` -
each flag's purpose and omission behavior is documented in Usage above.
Replace `<pwd>`, `<timestamp>`, and `<date>` with the actual values and keep
the quotes in case the path has spaces:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/lib/repo-review.js",
  args: "$ARGUMENTS --out \"<pwd>/repo-review-out\" --stamp <timestamp> --date <date>"
})
```

Invoke by `scriptPath` EXACTLY as shown - NEVER by name. The engine is
deliberately not a registered workflow, so `Workflow({name: "repo-review"})`
fails with "Workflow not found"; do not try it first and fall back.

Right after launching, tell the user how to watch the workers (see
Monitoring below): the peek command verbatim.

Always pass `args` as this single string - `$ARGUMENTS` forwarded unchanged
(except for flavors/`--profile`/`--for` the user chose in the pre-launch
questions, folded in as described above) with `--out`, `--stamp`, and `--date`
appended. The engine does the parsing (see
Usage above); do not restructure the arguments into an object yourself.

## Monitoring - telling the user what the workers are doing

When the user asks what the review is doing (or it looks stuck), answer with
FACTS from the ground truth below - never speculate about what an agent is
"probably" doing, and never guess at failure causes you have not verified:

- **Enforced peek (primary)**: `node ${CLAUDE_PLUGIN_ROOT}/scripts/peek.mjs`
  renders every worker's recent tool calls straight from the harness-written
  transcripts. The harness appends each call the moment it is made, so this
  view cannot be skipped, delayed, or faked by a worker. It shows each
  worker's lens, running/finished state, last-activity age, and recent
  commands. Give the user this command verbatim right after launch. (There
  is deliberately no model-written progress file: workers narrating their
  own status proved unreliable - absent or fabricated - so the only status
  channels are enforced ones.)
- **Transcripts** are the raw authority the peek renders: every tool call
  and result is in
  `<project transcript dir>/<session-id>/subagents/workflows/<run-id>/agent-<id>.jsonl`,
  and `journal.jsonl` beside it records spawn order and each agent's return
  value. Read the tail before explaining any stall - e.g. a background task
  whose output file is 0 bytes may simply be a healthy compute-bound job that
  has not flushed yet; the transcript shows what was actually launched.
- **Retry loops look like progress**: `started` entries in `journal.jsonl`
  that share the same `key` are RETRIES of one agent() call, not new lenses.
  Check for that before reporting how far along the run is.

**Fallback** (no Workflow tool). The Workflow engine is only deterministic
orchestration - the reviewing is agent work, so reproduce the structure with
subagents.

If you can spawn subagents (Task/Agent tool): parse the arguments as the
workflow would. For each repo, ONE AT A TIME (keep profiling uncontended and
RAM bounded), spawn the five lens reviewers as separate subagents - each with
its lens brief: clone/build/run a fresh copy, WRITE AND RUN ITS OWN TESTS,
profile hot paths, score the seven axes 1-10, recommend on the profile's
verdict scale, and write its per-lens doc. Include today's date (from
`date +%Y-%m-%d`) in each brief so reviewers don't flag recent dates, versions,
or citations as "future" or fabricated. Then reconcile the scores yourself
- lens-weighted: the owning lens counts double on its own axis; honesty and
overall are a plain mean - and write the memo (verdict, outliers,
disagreements, consensus, oversell/undersell call, fixes) to
`<pwd>/repo-review-out/<repo>/MEMO.md` - an absolute path anchored at the
invocation directory (`pwd`), and likewise the per-lens docs, so they survive
each reviewer's temp-clone cleanup.

If you cannot spawn subagents, do it inline as a single reviewer across the
five lenses - lower fidelity; note the reduced independence.

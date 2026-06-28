---
description: Clone, build, run, and review a repo across five lenses
argument-hint: <repo-path[:flavor]>... [--profile <name>] [--for <text>]
---

Review one or more code repositories by actually standing each up: clone,
build, run a demo, then judge across five lenses (performance, correctness,
engineering, taste & positioning, documentation) and synthesize a scored
review. The **profile** (who is judging and how to grade; default general)
applies to the whole run. Each repo's **flavor** (what it is for, tuning
per-lens expectations) is resolved per repo: an explicit `path:flavor` if
given, else auto-detected by a per-repo detection agent.

Pass `$ARGUMENTS` through to the workflow unchanged - it parses the tokens
itself (each non-flag token is a repo, optionally `path:flavor` for known
flavors performance/research/production/personal; `--profile <name>` sets the
run profile; `--for "<text>"` adds free-text specialization, e.g. a target
company/role). Do not pre-parse.

## Run

**Preferred - Workflow orchestration.** If the Workflow tool is available (this
command invocation is your authorization), use it:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/repo-review.js",
  args: "$ARGUMENTS"
})
```

The workflow also accepts a structured object, so an agent invoking it
programmatically can skip the string entirely:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/repo-review.js",
  args: {
    repos: [{ path: "./a", flavor: "performance" }, { path: "./b" }],
    profile: "job",
    specialization: "a RE role at Anthropic"
  }
})
```

Both forms normalize to the same `{ repos, profile, specialization }`.

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
`repo-review-out/<repo>/MEMO.md`.

If you cannot spawn subagents, do it inline as a single reviewer across the
five lenses - lower fidelity; note the reduced independence.

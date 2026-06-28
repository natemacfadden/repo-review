---
description: Clone, build, run, and review a repo across five lenses
argument-hint: <repo-path[:flavor]>... [--profile <name>]
---

STUB - wiring only; behavior filled in a later step.

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
run profile). Do not pre-parse.

## Run

**Preferred - Workflow orchestration.** If the Workflow tool is available (this
command invocation is your authorization), use it:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/repo-review.js",
  args: "$ARGUMENTS"
})
```

**Fallback** (no Workflow tool): TODO - single-agent inline review.

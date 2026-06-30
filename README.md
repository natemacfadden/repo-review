# repo-review
*[Nate MacFadden](https://github.com/natemacfadden)*
*Developed with [Claude Code](https://claude.com/claude-code).*

A Claude Code plugin that reviews one or more code repositories by **actually
running them** - clone, build, run a demo - then judges each across five lenses
(performance, correctness, engineering, taste & positioning, documentation) and
synthesizes a scored review. Two overlays tune the review: a **profile** (who is
judging and how to grade; default a general code-quality review) and a
**flavor** (what the repo is for, e.g. high-performance vs. personal).

## Install

Run these as slash commands inside a Claude Code session (not a shell):

```
/plugin marketplace add natemacfadden/repo-review
/plugin install repo-review@repo-review
/reload-plugins
```

`/reload-plugins` activates it in the current session without a restart. Then:

```
/repo-review:review <repo-path>[:flavor]...
```

For the full options reference - profiles, flavors, `--for`, `--out` - run:

```
/repo-review:review --help
```

(The command is `/repo-review:review`: Claude Code namespaces plugin commands
as `/<plugin>:<command>`.)

## Update

Picking up a newer pushed version takes a full reinstall, not just a
marketplace refresh. `/plugin marketplace update` refreshes the catalog clone,
but the installed plugin is a separate cached snapshot that only changes when
you reinstall - so `marketplace update` + `/reload-plugins` alone does **not**
pick up changes (observed in practice). Run all four:

```
/plugin uninstall repo-review@repo-review
/plugin marketplace update repo-review
/plugin install repo-review@repo-review
/reload-plugins
```

The `uninstall` also drops any renamed or removed command so it does not linger.

## Uninstall

Run as slash commands inside a Claude Code session:

```
/plugin uninstall repo-review@repo-review
/plugin marketplace remove repo-review
/reload-plugins
```

Removing the marketplace also uninstalls any plugin installed from it, so the
first line is optional. `/reload-plugins` applies the removal to the current
session without a restart. Nothing here touches the source repo - plugin state
lives only in `~/.claude/`.

## Architecture

Two layers, on purpose:

- **Command / skill** (`commands/review.md` -> `/repo-review:review`) - the
  user-facing entry point. It parses the arguments, runs `pwd` to capture the
  invocation directory, injects `--out`, serves `--help`/usage, then hands a
  fully-formed call to the engine.
- **Workflow engine** (`lib/repo-review.js`) - Anthropic's deterministic
  *workflow* construct, which does the orchestration: it spawns the worker
  agents, reconciles their scores in code, and drives the synthesis.

In model terms: the command is a **doorman** that interprets the request and
sets up the arguments and output path; the engine then spawns the models that
actually think - a flavor detector, five **independent** lens reviewers (each
in its own clone, so the takes stay unbiased), and a synthesizer that writes
the memo. Score reconciliation between reviewers is plain code, not a model.

**Why have the command at all, instead of just the workflow?** The workflow
runs in a restricted, deterministic sandbox and is invoked programmatically by
path with a fixed `args` string - it can't read the environment (e.g. the
current directory, which we need so output lands deterministically) or present
a CLI. The command is the thin, agent-driven adapter that gathers that context
plus the user's input and translates it into a proper workflow call. So it
isn't redundant with the engine - it does the setup the sandboxed engine
structurally cannot.

## Layout

```
repo-review/                       <- this repo doubles as a marketplace
├── .claude-plugin/
│   └── marketplace.json           <- self-host catalog (alt install)
└── plugins/
    └── repo-review/               <- the plugin
        ├── .claude-plugin/plugin.json
        ├── commands/review.md         <- entry point; invokes the workflow
        └── lib/repo-review.js         <- the workflow engine (lenses + PROFILE)
```

> **Why `lib/` and not `workflows/`?** Sorry, this is a deliberate misnomer.
> `lib/repo-review.js` is a workflow, and would normally live in `workflows/`.
> But Claude Code auto-registers any workflow under `workflows/` as its own
> invokable `/repo-review:repo-review` skill, which duplicated the real entry
> point and would let users bypass the command's setup. Parking it in `lib/`
> (a non-auto-scanned directory) keeps a single clean entry point,
> `/repo-review:review`, which loads the engine by explicit path. See the
> open question filed with Claude Code about a first-class way to mark a
> workflow internal.

## Development

For development and CI only - **not** needed to use the plugin. Installing via
`/plugin` runs it inside Claude Code, which supplies the workflow runtime; none
of the tooling below ships as a runtime dependency.

Prerequisites: conda and the Claude Code CLI.

```
conda env create -f environment.yml   # runtime layer: node
conda activate repo-review
npm install                           # package layer: dev tools -> node_modules
```

Run all checks (the same entry point CI runs):

```
bash scripts/check.sh                 # or: npm run check
```

It runs ascii, editorconfig, JSON-manifest, workflow-syntax, meta-validity, and
`claude plugin validate --strict` checks, plus the unit-test suite, collecting
every failure before exiting non-zero. Tools that aren't installed (and the
tests, until they exist) are skipped, not failed.

Run just the unit tests during development:

```
npm test
```

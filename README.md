# repo-review
*[Nate MacFadden](https://github.com/natemacfadden)*
*Developed with [Claude Code](https://claude.com/claude-code).*

A Claude Code plugin that reviews one or more code repositories by **actually
running them** - clone, build, run a demo - then judges each across five lenses
(performance, correctness, engineering, taste & positioning, documentation) and
synthesizes a scored review. Two overlays tune the review: a **profile** (who is
judging and how to grade; default a general code-quality review) and a
**flavor** (what the repo is for, e.g. high-performance vs. personal).

> **Status:** in development - workflow logic in progress.

## Install

Run these as slash commands inside a Claude Code session (not a shell):

```
/plugin marketplace add natemacfadden/repo-review
/plugin install repo-review@repo-review
/reload-plugins
```

`/reload-plugins` activates it in the current session without a restart. Then:

```
/repo-review <repo-path>[:flavor]... [--profile <name>] [--for "<text>"]
```

- `<repo-path>[:flavor]...` - one or more repos (batch); attach `:flavor` to
  set that repo's flavor explicitly
- `--profile <name>` - audience and verdict framing for the whole run
  (default: general)
- `--for "<text>"` - free-text specialization of the profile, e.g. a target
  company or role (quote multi-word values)

Flavor (what the repo is for - tunes per-lens expectations) is resolved per
repo: an explicit `:flavor` if given, else auto-detected from the repo. Values:
`performance`, `research`, `production`, `personal`.

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

## Layout

```
repo-review/                       <- this repo doubles as a marketplace
├── .claude-plugin/
│   └── marketplace.json           <- self-host catalog (alt install)
└── plugins/
    └── repo-review/               <- the plugin
        ├── .claude-plugin/plugin.json
        ├── commands/repo-review.md    <- entry point; invokes the workflow
        └── workflows/repo-review.js   <- the workflow (CORE lenses + PROFILE)
```

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

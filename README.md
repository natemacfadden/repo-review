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
```

Then, in the same session:

```
/repo-review <repo-path>[:flavor]... [--profile <name>]
```

- `<repo-path>[:flavor]...` - one or more repos (batch); attach `:flavor` to
  set that repo's flavor explicitly
- `--profile <name>` - audience and verdict framing for the whole run
  (default: general)

Flavor (what the repo is for - tunes per-lens expectations) is resolved per
repo: an explicit `:flavor` if given, else auto-detected from the repo. Values:
`performance`, `research`, `production`, `personal`.

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

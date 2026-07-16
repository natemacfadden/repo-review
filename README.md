# repo-review
*[Nate MacFadden](https://github.com/natemacfadden)*
*Developed with [Claude Code](https://claude.com/claude-code).*

A Claude Code plugin that reviews one or more code repositories by **actually
running them** - clone, build, run a demo - then judges each across five lenses
(performance, correctness, engineering, taste & positioning, documentation) and
synthesizes a scored review. Two overlays tune the review: a **profile** (who is
judging and how to grade; default a general code-quality review) and a
**flavor** (what the repo is for, e.g. high-performance vs. personal).

## How the review is shaped

- **Lenses** - the same five every run, each a separate reviewer working in
  its own clone, so the takes stay independent.
- **`--profile`** - *who* is judging and the verdict scale. `general`
  (default) grades it as software (Excellent-Poor); `--profile job` grades it
  as a hiring committee (Strong Hire-No-Hire); `--profile oss-audit` asks
  "should we depend on this?" (Adopt / Use with care / Avoid);
  `--profile student-project` grades it A-F.
- **`:flavor`** (per repo) - *what the repo is for*, which tunes what each lens
  expects. `./api:performance` demands real benchmarks; `./toy:personal`
  won't penalize missing CI. Omit it and the flavor is auto-detected.
- **`--for "<text>"`** - free-text specialization on top of the profile.
  `--profile job --for "a senior frontend role at a design-led startup"`
  shifts the same hiring lens toward design and UI polish.

So `./ui:performance --profile job --for "a Research Engineer role"` reviews
`./ui` as a high-performance codebase, judged by a hiring committee, for an RE
role - same five lenses, three different dials on top.

## Running

Two ways to run the same review - same arguments, same output under
`repo-review-out/<repo>/<stamp>/` (one doc per lens plus `MEMO.md`). The
reviewing logic is one host-agnostic engine (`lib/engine.mjs`); Claude Code and
[opencode](https://opencode.ai) each supply a thin adapter, so there is no fork.

### Claude Code (plugin)

Install once, as slash commands inside a session (not a shell):

```
/plugin marketplace add natemacfadden/repo-review
/plugin install repo-review@repo-review
/reload-plugins
```

Then run - `--help` lists every option (profiles, flavors, `--for`, `--out`):

```
/repo-review:review <repo>[:flavor]... [--profile <name>] [--for "<text>"]
/repo-review:review --help
```

To watch the lens workers, run the peek command the review prints at launch, or
use `/workflows`.

### opencode (terminal)

From a clone of this repo. Choose any model opencode knows with
`REPO_REVIEW_MODEL=provider/model` (`opencode models`; omit for the default) - a
local open-weights model works and costs nothing:

```
REPO_REVIEW_MODEL=ds4/deepseek-v4-flash \
  npm run review -- <repo>[:flavor]... [--profile <name>] [--for "<text>"]
```

The adapter runs one headless `opencode run` session per lens and logs each
phase to stdout, so redirect and tail to watch live:

```
REPO_REVIEW_MODEL=ds4/deepseek-v4-flash npm run review -- ~/code/foo >run.log 2>&1 &
tail -f run.log
```

When the model emits reasoning and opencode surfaces it, each lens's thinking is
saved to `repo-review-out/reasoning/`. (Some providers - e.g. custom
OpenAI-compatible endpoints - return reasoning the CLI drops, so those files
stay empty.)

A one-line run cheatsheet plus the update/uninstall steps sit at the [end of
this README](#run-quick-reference), so `cat README.md` leaves them on screen.

## Architecture

Two layers, on purpose:

- **Command / skill** (`commands/review.md` -> `/repo-review:review`) - the
  user-facing **doorman**. It parses the arguments, runs `pwd` to capture the
  invocation directory, injects `--out`, serves `--help`/usage, then hands a
  fully-formed call to the engine.
- **Workflow engine** (`lib/repo-review.js`) - Anthropic's deterministic
  *workflow* construct, which does the orchestration: it spawns the models
  that actually think - a flavor detector, five **independent** lens reviewers
  (each in its own clone, so the takes stay unbiased), and a synthesizer that
  writes the memo - and reconciles their scores in plain code, not a model.

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
conda env create -f environment.yml   # runtime layer: node (only prerequisite)
conda activate repo-review
```

### Editing the engine

The workflow is two files: **`plugins/repo-review/lib/engine.mjs`** is the
source you edit; **`plugins/repo-review/lib/repo-review.js`** is generated from
it by `scripts/build-cc.mjs` (the Claude Code runtime blocks `import`, so the
shipped file must be self-contained). After editing the engine, rebuild:

```
node scripts/build-cc.mjs
```

Enable the pre-commit hook once per clone so the artifact is rebuilt and staged
automatically on commit (CI also verifies it with `build-cc.mjs --check`):

```
git config core.hooksPath .githooks
```

No `npm install` is needed: `package.json` declares no dependencies - it only
provides the `npm run check` / `npm test` aliases below. The checkers in
`scripts/` and node's built-in test runner are self-contained.

Run all checks (the same entry point CI runs):

```
bash scripts/check.sh                 # or: npm run check
```

It runs lint, manifest, and workflow checks plus the unit-test suite (the
sections it prints are the authoritative list), collecting every failure
before exiting non-zero. Tools that aren't installed are skipped, not failed.

Run just the unit tests during development:

```
npm test
```

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

## Run (quick reference)

```
# Claude Code - in a session (see Running > Claude Code)
/repo-review:review <repo>[:flavor]... [--profile <name>] [--for "<text>"]

# opencode - in a terminal from a clone (see Running > opencode)
REPO_REVIEW_MODEL=<provider/model> npm run review -- <repo>[:flavor]...
```

## License

[GPLv3](LICENSE). Copyright (c) 2026 Nate MacFadden.

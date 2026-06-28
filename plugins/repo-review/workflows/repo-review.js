// repo-review - clone + build + run a repo, review across five lenses, synthesize
//
// STUB. structure only; logic ported in a later step.
// design: CORE lenses + clone/build/run, with a swappable PROFILE overlay

export const meta = {
  name: 'repo-review',
  description:
    'Clone, build, and run a repo, then review it across five lenses ' +
    '(performance, correctness, engineering, taste & positioning, docs) and ' +
    'synthesize a scored review under a selectable profile.',
  whenToUse:
    'Evaluate a code repo by actually standing it up and running it. Pass ' +
    'args = { repoPath, profile?, ...overrides } or a bare repo-path string. ' +
    'Default profile is a general code-quality review.',
  phases: [
    { title: 'Reviews', detail: 'one reviewer per lens' },
    { title: 'Synthesis', detail: 'reconcile scores + write the memo' },
  ],
}

// TODO(port): CORE lenses, clone/build/run machinery, schemas, orchestration
// TODO(port): PROFILE overlay selected by args.profile (default: general)
throw new Error('repo-review workflow not yet implemented - scaffold only')

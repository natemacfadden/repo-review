// pure path helpers shared by the engine and prompt builders. no deps, no
// side effects - safe to import anywhere

// filesystem-safe short name from a repo path, for temp dirs and output files
function repoSlug(path) {
  const trimmed = String(path || '').replace(/[/\\]+$/, '')
  const base = trimmed.split(/[/\\]/).pop()
  if (!base || base === '.' || base === '..') return 'repo'
  return base.replace(/[^A-Za-z0-9_.-]/g, '-') || 'repo'
}

// per-repo output dir <outBase>/<slug>, with an optional run stamp nested
// beneath so re-runs don't clobber earlier ones. sanitize the stamp like a slug
function repoOutDir(outBase, slug, stamp) {
  const dir = `${outBase}/${slug}`
  return stamp ? `${dir}/${repoSlug(stamp)}` : dir
}

export { repoSlug, repoOutDir }

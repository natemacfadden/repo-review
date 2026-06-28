// minimal, self-contained editorconfig enforcer. reads .editorconfig and checks
// the rules we use (max_line_length, trim_trailing_whitespace,
// insert_final_newline, end_of_line, indent_style/size) on git-tracked and
// untracked-but-not-ignored files. unlike the npm wrapper, it downloads
// nothing, so CI never rate-limits.
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

function parseEditorconfig(text) {
  const sections = []
  let cur = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/[;#].*$/, '').trim()
    if (!line) continue
    const sec = line.match(/^\[(.+)\]$/)
    if (sec) {
      cur = { glob: sec[1], props: {} }
      sections.push(cur)
    } else {
      const kv = line.match(/^([\w.-]+)\s*=\s*(.+)$/)
      if (kv && cur) cur.props[kv[1].toLowerCase()] = kv[2].trim().toLowerCase()
    }
  }
  return sections
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// editorconfig glob -> RegExp over a basename (our patterns contain no '/')
function globToRe(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      re += '[^/]*'
    } else if (c === '?') {
      re += '[^/]'
    } else if (c === '{') {
      const end = glob.indexOf('}', i)
      const alts = glob.slice(i + 1, end).split(',')
      re += '(?:' + alts.map(escapeRe).join('|') + ')'
      i = end
    } else {
      re += escapeRe(c)
    }
  }
  return new RegExp('^' + re + '$')
}

function propsFor(sections, base) {
  const props = {}
  for (const s of sections) {
    if (globToRe(s.glob).test(base)) Object.assign(props, s.props)
  }
  return props
}

function trackedFiles() {
  const out = execSync('git ls-files -z --cached --others --exclude-standard', {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return out.split('\0').filter(Boolean)
}

const sections = parseEditorconfig(readFileSync('.editorconfig', 'utf8'))
const errs = []

for (const file of trackedFiles()) {
  let src
  try {
    src = readFileSync(file, 'utf8')
  } catch {
    continue // unreadable/binary - skip
  }
  if (src === '') continue
  const base = file.split('/').pop()
  const p = propsFor(sections, base)

  if (p.insert_final_newline === 'true' && !src.endsWith('\n')) {
    errs.push(`${file}: missing final newline`)
  }
  const lines = src.endsWith('\n') ? src.slice(0, -1).split('\n') : src.split('\n')
  const cap = p.max_line_length && p.max_line_length !== 'off'
    ? parseInt(p.max_line_length, 10)
    : 0
  const size = p.indent_size ? parseInt(p.indent_size, 10) : 0

  lines.forEach((ln, i) => {
    const n = i + 1
    if (p.end_of_line === 'lf' && ln.includes('\r')) {
      errs.push(`${file}:${n}: carriage return (want lf)`)
    }
    if (p.trim_trailing_whitespace === 'true' && /[ \t]+$/.test(ln)) {
      errs.push(`${file}:${n}: trailing whitespace`)
    }
    if (cap && ln.length > cap) {
      errs.push(`${file}:${n}: line is ${ln.length} chars (max ${cap})`)
    }
    const indent = ln.match(/^[ \t]*/)[0]
    if (p.indent_style === 'space' && indent.includes('\t')) {
      errs.push(`${file}:${n}: tab in indentation (want spaces)`)
    }
    if (p.indent_style === 'space' && size && ln.trim() && indent.length % size) {
      errs.push(`${file}:${n}: indent ${indent.length} not a multiple of ${size}`)
    }
  })
}

if (errs.length) {
  for (const e of errs) console.error(`  ${e}`)
  console.error(`editorconfig: ${errs.length} issue(s)`)
  process.exit(1)
}
console.log('editorconfig: clean')

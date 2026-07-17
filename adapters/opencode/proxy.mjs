#!/usr/bin/env node
// forwards opencode's requests to the ds4 server, but injects tool_choice:none
// on opencode's compaction summaries so ds4 returns text - working around
// opencode's throw on a tool call during summary (ds4 honors tool_choice)
//   RR_DS4_URL=http://host:8000 node proxy.mjs    (listens on RR_PROXY_PORT)
import http from 'node:http'

const PORT = Number(process.env.RR_PROXY_PORT || 8010)
const UPSTREAM = new URL(process.env.RR_DS4_URL || 'http://127.0.0.1:8000')

// opencode's compaction-prompt signatures; a lens reviews repos, never "our
// conversation", so these don't match normal lens traffic
const SUMMARY_SIGNATURES = [
  'tasked with summarizing conversations',
  'Summarize our conversation above',
]
const isSummary = (text) => SUMMARY_SIGNATURES.some((s) => text.includes(s))

const server = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    let body = Buffer.concat(chunks)
    let forced = false
    const chat = req.method === 'POST' && /chat\/completions/.test(req.url)
    if (chat && body.length) {
      const text = body.toString('utf8')
      if (isSummary(text)) {
        try {
          const j = JSON.parse(text)
          j.tool_choice = 'none'
          body = Buffer.from(JSON.stringify(j))
          forced = true
        } catch { /* not json - forward unchanged */ }
      }
    }
    const headers = { ...req.headers, host: UPSTREAM.host }
    if (body.length) headers['content-length'] = Buffer.byteLength(body)
    const fwd = http.request({
      protocol: UPSTREAM.protocol, hostname: UPSTREAM.hostname,
      port: UPSTREAM.port, method: req.method, path: req.url, headers,
    }, (upRes) => {
      if (forced) console.log('rr-proxy: forced tool_choice=none on a summary')
      res.writeHead(upRes.statusCode, upRes.headers)
      upRes.pipe(res)
    })
    fwd.on('error', (e) => {
      res.writeHead(502)
      res.end(`rr-proxy upstream error: ${e.message}`)
    })
    if (body.length) fwd.write(body)
    fwd.end()
  })
})
server.listen(PORT, () => console.log(`rr-proxy: :${PORT} -> ${UPSTREAM.origin}`))

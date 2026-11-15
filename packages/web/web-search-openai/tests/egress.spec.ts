import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { installProxyFromEnvironment } from '@deepseek-ai/dsh-http-proxy'
import { OpenAIWebSearchProvider } from '../src/provider.ts'

let seen: string[] = []
let proxy: Server
let proxyUrl: string

beforeAll(async () => {
  proxy = createServer((request, response) => {
    seen.push(`REQ ${request.url ?? ''}`)
    response.writeHead(502); response.end('fake-proxy')
  })
  proxy.on('connect', (request, socket) => {
    seen.push(`CONNECT ${request.url ?? ''}`)
    socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n'); socket.end()
  })
  const address = await new Promise<AddressInfo>((resolve) => {
    proxy.listen(0, '127.0.0.1', () => { resolve(proxy.address() as AddressInfo) })
  })
  proxyUrl = `http://127.0.0.1:${String(address.port)}`
})

afterAll(async () => { await new Promise<void>((resolve) => { proxy.close(() => { resolve() }) }) })

/** The launch environment of a user who exported one proxy for both schemes. */
function proxyEnv(): { get(name: string): { value: string } | undefined } {
  return { get: name => (name === 'HTTP_PROXY' || name === 'HTTPS_PROXY' ? { value: proxyUrl } : undefined) }
}

/** Capture proxy traffic for one operation and restore the global dispatcher. */
async function observe(run: () => Promise<unknown>): Promise<string[]> {
  seen = []
  const dispose = await installProxyFromEnvironment(proxyEnv(), () => undefined)
  try { await run().catch(() => undefined) } finally { await dispose() }
  return seen
}

describe('OpenAI web search egress', () => {
  it('uses the configured proxy for the fixed official endpoint', async () => {
    const provider = new OpenAIWebSearchProvider(() => ({
      resolveApiKey: async () => 'probe',
      apiKeyEnv: credentialRef('OPENAI_API_KEY'),
      model: 'gpt-5.4-mini',
      searchContextSize: 'low',
      maxOutputTokens: 16,
      maxToolCalls: 1,
      timeoutMs: 1000,
    }))
    expect(await observe(() => provider.search({ query: 'probe' }))).toEqual(['CONNECT api.openai.com:443'])
  })
})

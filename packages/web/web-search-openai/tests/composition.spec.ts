/** Real Loader composition for OpenAI search beside the unchanged HTTP fetch provider. */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ModuleLoaderV2 } from '@deepseek-ai/cordis-plugin-loader'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as fetchHttpPlugin from '@deepseek-ai/dsh-web-fetch-http'
import * as openaiPlugin from '@deepseek-ai/dsh-web-search-openai'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.unstubAllGlobals()
})

const MODULES = new Map<string, unknown>([
  ['@deepseek-ai/dsh-web', WebRuntime],
  ['@deepseek-ai/dsh-web-fetch-http', fetchHttpPlugin],
  ['@deepseek-ai/dsh-web-search-openai', openaiPlugin],
])

/** Boot a private Loader tree with only network dispatch stubbed. */
async function bootComposition(): Promise<{ ctx: Context; fetchMock: ReturnType<typeof vi.fn> }> {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url === 'https://api.openai.com/v1/responses') {
      return Response.json({
        status: 'completed',
        output: [{
          type: 'web_search_call', status: 'completed',
          action: { type: 'search', sources: [{ type: 'url', url: 'https://source.test/' }] },
        }],
      })
    }
    if (url === 'https://page.test/') {
      return new Response('<h1>Page</h1>', { headers: { 'content-type': 'text/html' } })
    }
    throw new Error(`unexpected fixture request ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  const root = await mkdtemp(join(tmpdir(), 'dsh-web-search-openai-composition-'))
  cleanups.push(async () => { await rm(root, { recursive: true, force: true }) })
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  cleanups.push(async () => {
    if (previousHome === undefined) Reflect.deleteProperty(process.env, 'DSH_HOME')
    else process.env.DSH_HOME = previousHome
  })
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, JSON.stringify([
    {
      id: 'web', name: '@deepseek-ai/dsh-web',
      config: { searchProvider: 'openai-web-search', fetchProvider: 'http' },
    },
    { id: 'web-search-openai', name: '@deepseek-ai/dsh-web-search-openai' },
    { id: 'web-fetch-http', name: '@deepseek-ai/dsh-web-fetch-http' },
  ]))
  const ctx: Context = await boot('web-search-openai-composition', configPath, [], (host) => {
    const modules: ModuleLoaderV2 = {
      version: 'v2', loadCache: new Map(),
      async import(specifier) {
        if (!MODULES.has(specifier)) throw new Error(`unexpected fixture module ${specifier}`)
        return MODULES.get(specifier)
      },
      register(): never { throw new Error('unexpected module hook registration') },
      getOrCreateModuleJob(): never { throw new Error('unexpected module job creation') },
      resolveSync(): never { throw new Error('unexpected synchronous module resolution') },
      load(): never { throw new Error('unexpected module load') },
    }
    host.loader.internal = modules
    host.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{
      source: 'process', values: { OPENAI_API_KEY: 'composition-key' },
    }]))
  })
  cleanups.push(async () => { await ctx.fiber.dispose() })
  return { ctx, fetchMock }
}

describe('OpenAI search real Loader composition', () => {
  it('serves OpenAI search and keeps the existing HTTP fetch path', async () => {
    const { ctx, fetchMock } = await bootComposition()
    const pageServer = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' }).end('<h1>Page</h1>')
    })
    const pageUrl = await listen(pageServer)
    cleanups.push(async () => { await close(pageServer) })
    expect(await ctx.web.searchReady(undefined)).toBe(true)
    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({
      sources: [{ url: 'https://source.test/' }],
    })
    await expect(ctx.web.fetch({ url: pageUrl })).resolves.toMatchObject({
      url: pageUrl, statusCode: 200, body: { kind: 'html' },
    })
    expect(fetchMock).toHaveBeenCalledOnce()

    const entry = [...ctx.loader.entries()].find(row => row.options.id === 'web-search-openai')
    if (entry?.fiber === undefined) throw new Error('expected active OpenAI search entry')
    await entry.fiber.dispose()
    expect(ctx.web.listProviders().search).toEqual([])
    expect(ctx.web.listProviders().fetch.map(provider => provider.id)).toEqual(['http'])
  })
})

/** Bind a loopback fixture atomically and return its page URL. */
async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}/`
}

/** Close the page fixture after every request settles. */
async function close(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => server.close((error) => {
    if (error === undefined) resolve()
    else reject(error)
  }))
}

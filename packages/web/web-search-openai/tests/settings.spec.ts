import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { createLaunchEnvironmentSnapshot, DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as openaiPlugin from '@deepseek-ai/dsh-web-search-openai'

function requestJson(init?: RequestInit): unknown {
  if (typeof init?.body !== 'string') throw new Error('expected a string request body')
  const value: unknown = JSON.parse(init.body)
  return value
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('web-search-openai settings and credentials', () => {
  it('rejects a credential reference outside the shared environment-name grammar', () => {
    expect(() => openaiPlugin.Config({ apiKeyEnv: 'not-a-reference!' })).toThrow('regexp')
    expect(() => openaiPlugin.Config({ maxOutputTokens: 15 })).toThrow('number >= 16')
  })

  it('tracks credential changes and serves live settings without re-registering', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-web-search-openai-settings-'))
    const ctx = new Context()
    try {
      const append = vi.fn()
      ctx.provide('agents', { currentInitiator: () => ({ session: { append } }) } as never)
      await ctx.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), watch: false })
      await ctx.plugin(WebRuntime, { searchProvider: 'openai-web-search' })
      const live = await liveConfig(ctx, openaiPlugin, {})
      expect(ctx.web.listProviders().search).toMatchObject([{
        id: 'openai-web-search', title: 'OpenAI web search',
      }])
      expect(await ctx.web.searchReady(undefined)).toBe(false)

      await ctx.credentials.set(credentialRef('OPENAI_API_KEY'), 'first-key')
      expect(await ctx.web.searchReady(undefined)).toBe(true)
      const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json({
        status: 'completed',
        output: [{ type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [] } }],
      }))
      vi.stubGlobal('fetch', fetchMock)

      await live.update({
        model: 'gpt-5.4-mini-2026-03-17', searchContextSize: 'high',
        maxOutputTokens: 77, maxToolCalls: 2, country: 'JP', timeoutMs: 1234,
      })
      expect(ctx.web.listProviders().search).toHaveLength(1)
      await ctx.web.search({ query: 'q' })
      const body = requestJson(fetchMock.mock.calls[0]?.[1])
      expect(body).toMatchObject({
        model: 'gpt-5.4-mini-2026-03-17', max_output_tokens: 77, max_tool_calls: 2,
        tools: [{ search_context_size: 'high', user_location: { type: 'approximate', country: 'JP' } }],
      })
      expect(append).toHaveBeenCalledWith('web/openai-search-llm-request', {
        endpoint: 'https://api.openai.com/v1/responses', body,
      })

      await ctx.credentials.unset(credentialRef('OPENAI_API_KEY'))
      expect(await ctx.web.searchReady(undefined)).toBe(false)
      fetchMock.mockClear()
      await expect(ctx.web.search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
      expect(fetchMock).not.toHaveBeenCalled()

      await live.fiber.dispose()
      expect(ctx.web.listProviders().search).toEqual([])
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('uses the captured launch environment when no credentials service is installed', async () => {
    const ctx = new Context()
    ctx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([{
      source: 'process', values: { OPENAI_API_KEY: 'ambient-key' },
    }]))
    try {
      await ctx.plugin(WebRuntime, { searchProvider: 'openai-web-search' })
      const live = await liveConfig(ctx, openaiPlugin, {})
      const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json({
        status: 'completed',
        output: [{ type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [] } }],
      }))
      vi.stubGlobal('fetch', fetchMock)
      expect(await ctx.web.searchReady(undefined)).toBe(true)
      await ctx.web.search({ query: 'q' })
      expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer ambient-key')
      await live.fiber.dispose()
    } finally { await ctx.fiber.dispose() }
  })

  it('reports not ready when a configured credential store cannot be read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-web-search-openai-unreadable-'))
    const ctx = new Context()
    try {
      await ctx.plugin(LocalCredentialProvider, { path: join(root, '.credentials.yaml'), watch: false })
      await ctx.plugin(WebRuntime, { searchProvider: 'openai-web-search' })
      const live = await liveConfig(ctx, openaiPlugin, {})
      vi.spyOn(ctx.credentials, 'describe').mockRejectedValueOnce(new Error('vault offline'))
      expect(await ctx.web.searchReady(undefined)).toBe(false)
      await live.fiber.dispose()
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})

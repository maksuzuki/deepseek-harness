import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import WebRuntime from '@deepseek-ai/dsh-web'
import { formatSearchOutput } from '@deepseek-ai/dsh-tool-web'
import {
  mapOpenAIResponse,
  OPENAI_WEB_SEARCH_ENDPOINT,
  OPENAI_WEB_SEARCH_PROVIDER_ID,
  OpenAIWebSearchProvider,
  type OpenAIWebSearchProviderOptions,
} from '@deepseek-ai/dsh-web-search-openai'

const options: OpenAIWebSearchProviderOptions = {
  resolveApiKey: async () => 'sk-test',
  apiKeyEnv: credentialRef('OPENAI_API_KEY'),
  model: 'gpt-5.4-mini',
  searchContextSize: 'low',
  maxOutputTokens: 1024,
  maxToolCalls: 1,
  timeoutMs: 1000,
}

function provider(overrides: Partial<OpenAIWebSearchProviderOptions> = {}): OpenAIWebSearchProvider {
  return new OpenAIWebSearchProvider(() => ({ ...options, ...overrides }))
}

function completedResponse() {
  return {
    status: 'completed',
    output: [
      {
        type: 'web_search_call', status: 'completed',
        action: {
          type: 'search',
          sources: [
            { type: 'url', url: 'https://a.test/article' },
            { type: 'url', url: 'https://b.test/' },
          ],
        },
      },
      {
        type: 'message',
        content: [{
          type: 'output_text',
          annotations: [
            { type: 'url_citation', url: 'https://a.test/article', title: 'Article A' },
            { type: 'url_citation', url: 'https://c.test/report', title: 'Report C' },
          ],
        }],
      },
    ],
  } as const
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function requestJson(init?: RequestInit): unknown {
  if (typeof init?.body !== 'string') throw new Error('expected a string request body')
  const value: unknown = JSON.parse(init.body)
  return value
}

function abortReason(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new DOMException('aborted', 'AbortError')
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('mapOpenAIResponse', () => {
  it('combines action sources and URL citations without using generated prose', () => {
    expect(mapOpenAIResponse(completedResponse())).toEqual({
      sources: [
        { url: 'https://a.test/article', title: 'Article A' },
        { url: 'https://c.test/report', title: 'Report C' },
        { url: 'https://b.test/' },
      ],
      truncated: false,
    })
  })

  it('keeps citation order and prefers non-empty titles for duplicate URLs', () => {
    expect(mapOpenAIResponse({
      status: 'completed',
      output: [
        {
          type: 'web_search_call', status: 'completed', action: {
            type: 'search', sources: [
              { type: 'url', url: 'https://second.test/' },
              { type: 'url', url: 'https://first.test/' },
            ],
          },
        },
        { type: 'message', content: [{ annotations: [
          { type: 'url_citation', url: 'https://first.test', title: '' },
          { type: 'url_citation', url: 'https://second.test/', title: 'Second' },
          { type: 'url_citation', url: 'https://first.test/', title: 'First' },
          { type: 'url_citation', url: 'https://second.test', title: null },
        ] }] },
      ],
    })).toEqual({
      sources: [
        { url: 'https://first.test', title: 'First' },
        { url: 'https://second.test/', title: 'Second' },
      ],
      truncated: false,
    })
  })

  it('keeps action source order when the response has no URL citations', () => {
    expect(mapOpenAIResponse({
      status: 'completed',
      output: [{
        type: 'web_search_call', status: 'completed', action: {
          type: 'search', sources: [
            { type: 'url', url: 'https://first.test/' },
            { type: 'url', url: 'https://second.test/' },
          ],
        },
      }],
    })).toEqual({
      sources: [{ url: 'https://first.test/' }, { url: 'https://second.test/' }],
      truncated: false,
    })
  })

  it('deduplicates normalized URLs and drops missing, malformed, and non-HTTP URLs', () => {
    expect(mapOpenAIResponse({
      status: 'completed',
      output: [{
        type: 'web_search_call', status: 'completed', action: {
          type: 'search', sources: [
            { type: 'url', url: 'https://a.test' },
            { type: 'url', url: 'https://a.test/' },
            { type: 'url', url: '' },
            { type: 'url', url: 'not a URL' },
            { type: 'url', url: 'file:///secret' },
          ],
        },
      }],
    })).toEqual({ sources: [{ url: 'https://a.test' }], truncated: false })
  })

  it('tolerates omitted message fields and drops invalid, missing, and non-HTTP citation URLs', () => {
    expect(mapOpenAIResponse({
      status: 'completed',
      output: [
        { type: 'web_search_call', status: 'completed', action: { type: 'search' } },
        { type: 'message' },
        { type: 'message', content: [{ type: 'output_text' }] },
        { type: 'message', content: [{ type: 'output_text', annotations: [
          { type: 'file_citation', url: 'https://ignored.test/' },
          { type: 'url_citation', url: 'https://a.test/', title: '' },
          { type: 'url_citation', url: 'https://a.test/', title: 'duplicate' },
          { type: 'url_citation', url: null, title: 'missing' },
          { type: 'url_citation', title: 'omitted' },
          { type: 'url_citation', url: 'not a URL', title: 'invalid' },
          { type: 'url_citation', url: 'file:///secret', title: 'local' },
        ] }] },
      ],
    })).toEqual({ sources: [{ url: 'https://a.test/', title: 'duplicate' }], truncated: false })
  })

  it('accepts documented nulls on optional response collections and citation fields', () => {
    expect(mapOpenAIResponse({
      status: 'completed',
      output: [
        { type: 'web_search_call', status: 'completed', action: { type: 'search', sources: null } },
        { type: 'message', content: null },
        { type: 'message', content: [{ annotations: [{ type: 'url_citation', url: null, title: null }] }] },
      ],
    })).toEqual({ sources: [], truncated: false })
  })

  it.each([
    [null, 'response must be an object'],
    [{ status: 'completed', output: 'items' }, 'output must be an array of objects'],
    [{ status: 'completed', output: [null] }, 'output must be an array of objects'],
    [{ status: 'completed', output: [
      { type: 'web_search_call', status: 'completed', action: { type: 'search', sources: 'items' } },
    ] }, 'sources must be an array of objects'],
    [{ status: 'completed', output: [
      { type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [{ url: 42 }] } },
    ] }, 'url must be a string or null'],
    [{ status: 'completed', output: [
      { type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [] } },
      { type: 'message', content: 'blocks' },
    ] }, 'message.content must be an array of objects'],
    [{ status: 'completed', output: [
      { type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [] } },
      { type: 'message', content: [{ annotations: 'items' }] },
    ] }, 'annotations must be an array of objects'],
    [{ status: 'completed', output: [
      { type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [] } },
      { type: 'message', content: [{ annotations: [{ type: 'url_citation', url: 'https://a.test', title: 42 }] }] },
    ] }, 'title must be a string or null'],
  ])('rejects malformed wire data before mapping', (response, message) => {
    expect(() => mapOpenAIResponse(response)).toThrow(message)
  })

  it.each([
    [{ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] }, /not completed: max_output_tokens/],
    [{ status: 'incomplete', incomplete_details: { reason: '' }, output: [] }, /not completed$/],
    [{ status: 'incomplete', incomplete_details: { reason: null }, output: [] }, /not completed$/],
    [{ status: 'incomplete', output: [] }, /not completed$/],
    [{ status: 'completed' }, /no web_search_call/],
    [{ status: 'completed', output: [] }, /no web_search_call/],
    [{ status: 'completed', output: [{ type: 'web_search_call', status: 'incomplete', action: { type: 'search' } }] }, /not completed/],
  ])('rejects unsuccessful search evidence', (response, message) => {
    expect(() => mapOpenAIResponse(response)).toThrow(message)
  })
})

describe('OpenAIWebSearchProvider request', () => {
  it('reports availability from the complete validated settings snapshot', () => {
    expect(provider().available()).toBe(true)
    expect(provider({ model: '' }).available()).toBe(false)
    expect(provider({ maxOutputTokens: 15 }).available()).toBe(false)
    expect(provider({ maxOutputTokens: 16 }).available()).toBe(true)
    expect(provider({ maxToolCalls: 1.5 }).available()).toBe(false)
    expect(provider({ timeoutMs: -1 }).available()).toBe(false)
    expect(provider({ country: 'Japan' }).available()).toBe(false)
    expect(provider({ country: 'jp' }).available()).toBe(true)
  })

  it('forces one hosted search, includes sources, disables storage, and sends no inferred location', async () => {
    const recordRequest = vi.fn()
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => jsonResponse(completedResponse()))
    vi.stubGlobal('fetch', fetchMock)
    await provider({ recordRequest }).search({ query: 'current fact', maxResults: 2 })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [endpoint, init] = fetchMock.mock.calls[0]!
    expect(endpoint).toBe(OPENAI_WEB_SEARCH_ENDPOINT)
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer sk-test')
    const body = requestJson(init)
    expect(body).toEqual({
      model: 'gpt-5.4-mini',
      input: 'current fact',
      tools: [{ type: 'web_search', search_context_size: 'low', user_location: { type: 'approximate' } }],
      tool_choice: 'required',
      max_tool_calls: 1,
      max_output_tokens: 1024,
      include: ['web_search_call.action.sources'],
      store: false,
    })
    expect(recordRequest).toHaveBeenCalledWith({ endpoint: OPENAI_WEB_SEARCH_ENDPOINT, body })
  })

  it('sends only an explicitly configured country and normalizes it to uppercase', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => jsonResponse(completedResponse()))
    vi.stubGlobal('fetch', fetchMock)
    await provider({ country: 'jp' }).search({ query: 'q' })
    const body = requestJson(fetchMock.mock.calls[0]?.[1])
    expect(body).toMatchObject({
      tools: [{ user_location: { type: 'approximate', country: 'JP' } }],
    })
  })

  it('applies maxResults through the shared web seam', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(completedResponse())))
    const ctx = new Context()
    try {
      await ctx.plugin(WebRuntime, { searchProvider: OPENAI_WEB_SEARCH_PROVIDER_ID })
      ctx.web.registerSearchProvider(provider())
      await expect(ctx.web.search({ query: 'q', maxResults: 2 })).resolves.toMatchObject({
        sources: [
          { url: 'https://a.test/article', title: 'Article A' },
          { url: 'https://c.test/report', title: 'Report C' },
        ],
        truncated: true,
      })
    } finally { await ctx.fiber.dispose() }
  })

  it('keeps cited sources visible through ctx.web and dsh-tool-web at the ten-result limit', async () => {
    const actionSources = Array.from({ length: 12 }, (_, index) => ({
      type: 'url', url: `https://source-${index}.test/`,
    }))
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      status: 'completed',
      output: [
        {
          type: 'web_search_call', status: 'completed', action: {
            type: 'search', sources: actionSources,
          },
        },
        { type: 'message', content: [{ annotations: [
          { type: 'url_citation', url: 'https://source-11.test/', title: 'Cited source 11' },
          { type: 'url_citation', url: 'https://citation-only.test/', title: 'Citation only' },
        ] }] },
      ],
    })))
    const ctx = new Context()
    try {
      await ctx.plugin(WebRuntime, { searchProvider: OPENAI_WEB_SEARCH_PROVIDER_ID })
      ctx.web.registerSearchProvider(provider())
      const result = await ctx.web.search({ query: 'q', maxResults: 10 })
      expect(result.sources).toHaveLength(10)
      expect(result.sources.slice(0, 2)).toEqual([
        { url: 'https://source-11.test/', title: 'Cited source 11' },
        { url: 'https://citation-only.test/', title: 'Citation only' },
      ])
      expect(result.truncated).toBe(true)
      const rendered = formatSearchOutput(result)
      expect(rendered.indexOf('[Cited source 11]')).toBeLessThan(rendered.indexOf('[Citation only]'))
      expect(rendered).toContain('Showing the first 10 sources.')
    } finally { await ctx.fiber.dispose() }
  })

  it('forwards caller cancellation and does not retry', async () => {
    const started = Promise.withResolvers<undefined>()
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => await new Promise<Response>((_resolve, reject) => {
      started.resolve(undefined)
      init?.signal?.addEventListener('abort', () => { reject(abortReason(init.signal ?? undefined)) }, { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const pending = provider().search({ query: 'q' }, controller.signal)
    await started.promise
    controller.abort(new DOMException('cancelled', 'AbortError'))
    await expect(pending).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('bounds the request with a timeout and does not retry', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(abortReason(init.signal ?? undefined)) }, { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(provider({ timeoutMs: 5 }).search({ query: 'q' })).rejects.toThrow('timed out after 5 ms')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it.each([400, 401, 402, 403, 429, 500])('maps HTTP %i without retrying', async (status) => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: { message: `failure-${status}` } }, { status }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(provider().search({ query: 'q' })).rejects.toThrow(new RegExp(`HTTP ${status}\\)`))
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it.each([
    [{ error: { code: 'quota_exceeded' } }, 'quota_exceeded'],
    [{ error: { type: 'server_error' } }, 'server_error'],
    [{}, 'HTTP 500)'],
    [{ error: { message: '' } }, 'HTTP 500)'],
    [null, 'HTTP 500)'],
    [{ error: null }, 'HTTP 500)'],
    [{ error: { message: 1, code: 2, type: 3 } }, 'HTTP 500)'],
  ])('extracts safe detail from OpenAI error envelopes', async (body, expected) => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(body, { status: 500 })))
    await expect(provider().search({ query: 'q' })).rejects.toThrow(expected)
  })

  it.each([401, 403])('does not expose credential fragments from HTTP %i messages', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      error: { message: 'Incorrect API key provided: sk-secret-fragment' },
    }, { status })))
    await expect(provider().search({ query: 'q' })).rejects.toSatisfy((error: Error) =>
      error.message.includes(`HTTP ${status}`) && !error.message.includes('sk-secret-fragment'))
  })

  it('falls back to the status when an HTTP error body is malformed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{', { status: 500 })))
    await expect(provider().search({ query: 'q' })).rejects.toThrow('HTTP 500)')
  })

  it('maps HTTP-client aborts while reading error and success bodies', async () => {
    for (const ok of [false, true]) {
      const response = {
        ok, status: ok ? 200 : 500,
        json: vi.fn(async () => { throw new DOMException('client stopped', 'AbortError') }),
      }
      vi.stubGlobal('fetch', vi.fn(async () => response))
      await expect(provider().search({ query: 'q' })).rejects.toThrow('reading was aborted')
    }
  })

  it.each([false, true])('preserves caller cancellation while reading a %s response', async (ok) => {
    const reading = Promise.withResolvers<undefined>()
    let requestSignal: AbortSignal | undefined
    const response = {
      ok, status: ok ? 200 : 500,
      json: vi.fn(async () => {
        reading.resolve(undefined)
        return await new Promise((_resolve, reject) => {
          requestSignal?.addEventListener('abort', () => { reject(abortReason(requestSignal)) }, { once: true })
        })
      }),
    }
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined
      return response
    }))
    const controller = new AbortController()
    const pending = provider().search({ query: 'q' }, controller.signal)
    await reading.promise
    controller.abort(new DOMException('cancelled', 'AbortError'))
    await expect(pending).rejects.toMatchObject({ code: 'WEB_ABORTED' })
  })

  it.each([false, true])('maps timeout while reading a %s response body', async (ok) => {
    let requestSignal: AbortSignal | undefined
    const response = {
      ok, status: ok ? 200 : 500,
      json: vi.fn(async () => await new Promise((_resolve, reject) => {
        requestSignal?.addEventListener('abort', () => { reject(abortReason(requestSignal)) }, { once: true })
      })),
    }
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined
      return response
    }))
    await expect(provider({ timeoutMs: 5 }).search({ query: 'q' })).rejects.toThrow('timed out after 5 ms')
  })

  it('preserves mapping errors from a syntactically valid response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ status: 'completed', output: [] })))
    await expect(provider().search({ query: 'q' })).rejects.toThrow('no web_search_call')
  })

  it('maps credential resolver failures and cancellation without dispatching', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const active = new AbortController()
    await expect(provider({ resolveApiKey: async () => { throw new Error('vault offline') } }).search({ query: 'q' }, active.signal))
      .rejects.toThrow('credential resolution failed')
    await expect(provider({ resolveApiKey: async () => { throw new DOMException('stopped', 'AbortError') } }).search({ query: 'q' }))
      .rejects.toMatchObject({ code: 'WEB_ABORTED' })
    const nonErrorResolver = async (): Promise<string | undefined> => {
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- verifies defensive normalization of foreign thenables.
      return await Promise.reject('non-Error rejection')
    }
    await expect(provider({ resolveApiKey: nonErrorResolver }).search({ query: 'q' }, active.signal))
      .rejects.toThrow('credential resolution failed')

    const controller = new AbortController()
    const waiting = Promise.withResolvers<string | undefined>()
    const pending = provider({ resolveApiKey: async () => await waiting.promise }).search({ query: 'q' }, controller.signal)
    controller.abort(new DOMException('cancelled', 'AbortError'))
    await expect(pending).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an already-aborted operation before credential resolution', async () => {
    const resolveApiKey = vi.fn(async () => 'sk-test')
    const controller = new AbortController()
    controller.abort()
    await expect(provider({ resolveApiKey }).search({ query: 'q' }, controller.signal))
      .rejects.toMatchObject({ code: 'WEB_ABORTED' })
    expect(resolveApiKey).not.toHaveBeenCalled()
  })

  it('maps an ordinary transport failure without request data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('socket closed') }))
    await expect(provider().search({ query: 'secret query' })).rejects.toSatisfy((error: Error) =>
      error.message.includes('socket closed') && !error.message.includes('secret query'))
  })

  it('rejects malformed JSON and missing credentials without dispatching a second request', async () => {
    const fetchMock = vi.fn(async () => new Response('{', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(provider().search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    expect(fetchMock).toHaveBeenCalledOnce()
    fetchMock.mockClear()
    await expect(provider({ resolveApiKey: async () => undefined }).search({ query: 'q' }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

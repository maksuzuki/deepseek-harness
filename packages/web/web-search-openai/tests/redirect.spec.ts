import { afterEach, describe, expect, it } from 'vitest'
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import {
  OPENAI_WEB_SEARCH_ENDPOINT, OpenAIWebSearchProvider, type OpenAIWebSearchProviderOptions,
} from '../src/provider.ts'

let previous: ReturnType<typeof getGlobalDispatcher> | undefined
let activeAgent: MockAgent | undefined

afterEach(async () => {
  if (previous !== undefined) setGlobalDispatcher(previous)
  previous = undefined
  const agent = activeAgent
  activeAgent = undefined
  if (agent !== undefined) await agent.close()
})

describe('OpenAIWebSearchProvider redirect policy', () => {
  it('rejects a redirect before contacting its target', async () => {
    const agent = new MockAgent()
    previous = getGlobalDispatcher()
    activeAgent = agent
    agent.disableNetConnect()
    let targetRequests = 0
    agent.get('https://api.openai.com').intercept({ path: '/v1/responses', method: 'POST' })
      .reply(307, '', { headers: { location: 'https://redirect.test/collect' } })
    agent.get('https://redirect.test').intercept({ path: '/collect', method: 'POST' })
      .reply(() => { targetRequests += 1; return { statusCode: 204, data: '' } })
    setGlobalDispatcher(agent)
    const options: OpenAIWebSearchProviderOptions = {
      resolveApiKey: async () => 'redirect-test-key',
      apiKeyEnv: credentialRef('OPENAI_API_KEY'),
      model: 'gpt-5.4-mini', searchContextSize: 'low', maxOutputTokens: 32, maxToolCalls: 1, timeoutMs: 1000,
    }
    const provider = new OpenAIWebSearchProvider(() => options)
    await expect(provider.search({ query: 'private redirect query' }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    expect(targetRequests).toBe(0)
    expect(agent.pendingInterceptors()).toMatchObject([{
      origin: 'https://redirect.test', path: '/collect', method: 'POST', timesInvoked: 0,
    }])
    expect(OPENAI_WEB_SEARCH_ENDPOINT).toBe('https://api.openai.com/v1/responses')
  })
})

import { describe, expect, it } from 'vitest'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import {
  OPENAI_WEB_SEARCH_DEFAULT_CONTEXT_SIZE,
  OPENAI_WEB_SEARCH_DEFAULT_MAX_OUTPUT_TOKENS,
  OPENAI_WEB_SEARCH_DEFAULT_MAX_TOOL_CALLS,
  OPENAI_WEB_SEARCH_DEFAULT_MODEL,
  OPENAI_WEB_SEARCH_DEFAULT_TIMEOUT_MS,
  OpenAIWebSearchProvider,
} from '../src/provider.ts'

const apiKey = process.env.OPENAI_API_KEY
const approved = process.env.DSH_OPENAI_WEB_SEARCH_E2E === '1'
const maybe = approved && apiKey !== undefined && apiKey.length > 0 ? describe : describe.skip

maybe('OpenAIWebSearchProvider real API', () => {
  it('returns URL-bearing sources from one explicitly approved hosted search', async () => {
    const provider = new OpenAIWebSearchProvider(() => ({
      resolveApiKey: async () => apiKey,
      apiKeyEnv: credentialRef('OPENAI_API_KEY'),
      model: process.env.OPENAI_WEB_SEARCH_MODEL ?? OPENAI_WEB_SEARCH_DEFAULT_MODEL,
      searchContextSize: OPENAI_WEB_SEARCH_DEFAULT_CONTEXT_SIZE,
      maxOutputTokens: OPENAI_WEB_SEARCH_DEFAULT_MAX_OUTPUT_TOKENS,
      maxToolCalls: OPENAI_WEB_SEARCH_DEFAULT_MAX_TOOL_CALLS,
      timeoutMs: OPENAI_WEB_SEARCH_DEFAULT_TIMEOUT_MS,
    }))
    const result = await provider.search({ query: 'What is the official OpenAI API documentation domain?', maxResults: 3 })
    expect(result.sources.length).toBeGreaterThan(0)
    for (const source of result.sources) expect(source.url).toMatch(/^https?:\/\//)
  }, 60_000)
})

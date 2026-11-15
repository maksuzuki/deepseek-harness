/** Register OpenAI Responses API web search in `ctx.web`. */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-web'
import z from '@deepseek-ai/schemastery'
import {
  OPENAI_WEB_SEARCH_DEFAULT_CONTEXT_SIZE,
  OPENAI_WEB_SEARCH_DEFAULT_MAX_OUTPUT_TOKENS,
  OPENAI_WEB_SEARCH_DEFAULT_MAX_TOOL_CALLS,
  OPENAI_WEB_SEARCH_DEFAULT_MODEL,
  OPENAI_WEB_SEARCH_DEFAULT_TIMEOUT_MS,
  OPENAI_WEB_SEARCH_MIN_OUTPUT_TOKENS,
  OpenAIWebSearchProvider,
  type OpenAIWebSearchContextSize,
  type OpenAIWebSearchProviderOptions,
} from './provider.ts'

export type {
  OpenAIWebSearchContextSize, OpenAIWebSearchLlmRequest, OpenAIWebSearchProviderOptions,
  OpenAIWebSearchRequestBody,
} from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-openai'

/** The web seam this provider registers into. */
export const inject = ['web']

const DEFAULT_API_KEY_ENV = 'OPENAI_API_KEY'

/** Live OpenAI search settings. */
export interface Config {
  /** Credential reference resolved per search. */
  readonly apiKeyEnv: Volatile<string>
  /** Auxiliary model. */
  readonly model: Volatile<string>
  /** Hosted search context size. */
  readonly searchContextSize: Volatile<OpenAIWebSearchContextSize>
  /** Generated and reasoning token ceiling. */
  readonly maxOutputTokens: Volatile<number>
  /** Maximum built-in tool calls. */
  readonly maxToolCalls: Volatile<number>
  /** Optional explicit ISO 3166-1 alpha-2 country; omitted sends no inferred location. */
  readonly country: Volatile<string | undefined>
  /** Request timeout in milliseconds. */
  readonly timeoutMs: Volatile<number>
}

export const Config = z.object({
  apiKeyEnv: z.string().pattern(/^[A-Za-z_][A-Za-z0-9_]*$/).role('credential-ref').default(DEFAULT_API_KEY_ENV).volatile(),
  model: z.string().default(OPENAI_WEB_SEARCH_DEFAULT_MODEL).volatile(),
  searchContextSize: z.union([z.const('low'), z.const('medium'), z.const('high')])
    .default(OPENAI_WEB_SEARCH_DEFAULT_CONTEXT_SIZE).volatile(),
  maxOutputTokens: z.number().step(1).min(OPENAI_WEB_SEARCH_MIN_OUTPUT_TOKENS)
    .default(OPENAI_WEB_SEARCH_DEFAULT_MAX_OUTPUT_TOKENS).volatile(),
  maxToolCalls: z.number().step(1).min(1).default(OPENAI_WEB_SEARCH_DEFAULT_MAX_TOOL_CALLS).volatile(),
  country: z.string().pattern(/^[A-Za-z]{2}$/).volatile(),
  timeoutMs: z.number().step(1).min(1).default(OPENAI_WEB_SEARCH_DEFAULT_TIMEOUT_MS).volatile(),
})

type ResolvedConfig = { [K in keyof Config]: ReturnType<Config[K]['get']> }

/** Resolve the current credential without retaining it on the provider. */
async function resolveApiKey(ctx: Context, ref: CredentialRef): Promise<string | undefined> {
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) return (await credentials.resolve(ref))?.value
  return launchEnvironmentOf(ctx).get(ref)?.value
}

/** Check credential presence without reading its value. */
async function credentialConfigured(ctx: Context, ref: CredentialRef): Promise<boolean> {
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) return (await credentials.describe(ref)).configured
  const ambient = launchEnvironmentOf(ctx).get(ref)
  return ambient !== undefined && ambient.value.length > 0
}

/** Project one live section into a per-operation options snapshot. */
function options(ctx: Context, config: ResolvedConfig): OpenAIWebSearchProviderOptions {
  const apiKeyEnv = credentialRef(config.apiKeyEnv)
  return {
    resolveApiKey: () => resolveApiKey(ctx, apiKeyEnv),
    apiKeyEnv,
    model: config.model,
    searchContextSize: config.searchContextSize,
    maxOutputTokens: config.maxOutputTokens,
    maxToolCalls: config.maxToolCalls,
    ...config.country === undefined ? {} : { country: config.country },
    timeoutMs: config.timeoutMs,
    recordRequest: (request) => {
      ctx.get('agents')?.currentInitiator()?.session.append('web/openai-search-llm-request', request)
    },
  }
}

/** Register the provider; readiness follows the current credential reference. */
export function apply(ctx: Context, config: Config): void {
  const section = (): ResolvedConfig => ({
    apiKeyEnv: config.apiKeyEnv.get(),
    model: config.model.get(),
    searchContextSize: config.searchContextSize.get(),
    maxOutputTokens: config.maxOutputTokens.get(),
    maxToolCalls: config.maxToolCalls.get(),
    country: config.country.get(),
    timeoutMs: config.timeoutMs.get(),
  })
  const current = () => options(ctx, section())
  const provider = new OpenAIWebSearchProvider(current)
  ctx.web.registerSearchProvider({
    id: provider.id,
    title: provider.title,
    description: provider.description,
    available: () => provider.available(),
    ready: async () => {
      try { return await credentialConfigured(ctx, current().apiKeyEnv) }
      catch (_unreadableStore) { return false }
    },
    search: (request, signal) => provider.search(request, signal),
  })
}

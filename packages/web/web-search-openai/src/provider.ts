/** OpenAI Responses API `web_search` provider for `ctx.web`. */

import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type {} from '@deepseek-ai/dsh-session'

/** Stable id this provider registers under. */
export const OPENAI_WEB_SEARCH_PROVIDER_ID = 'openai-web-search'

/** Fixed official Responses API endpoint; credentials are never forwarded to a configured origin. */
export const OPENAI_WEB_SEARCH_ENDPOINT = 'https://api.openai.com/v1/responses'

/** Default model used only for the auxiliary search turn. */
export const OPENAI_WEB_SEARCH_DEFAULT_MODEL = 'gpt-5.4-mini'

/** Default amount of retrieved search context supplied to the auxiliary model. */
export const OPENAI_WEB_SEARCH_DEFAULT_CONTEXT_SIZE = 'low' as const

/** Default maximum generated and reasoning tokens for the auxiliary response. */
export const OPENAI_WEB_SEARCH_DEFAULT_MAX_OUTPUT_TOKENS = 1024

/** Responses API minimum for `max_output_tokens`. */
export const OPENAI_WEB_SEARCH_MIN_OUTPUT_TOKENS = 16

/** Default maximum built-in tool calls in one auxiliary response. */
export const OPENAI_WEB_SEARCH_DEFAULT_MAX_TOOL_CALLS = 1

/** Default timeout for dispatch, response headers, and response body. */
export const OPENAI_WEB_SEARCH_DEFAULT_TIMEOUT_MS = 60_000

/** Exact secret-free Responses request recorded immediately before dispatch. */
export interface OpenAIWebSearchLlmRequest {
  /** Fixed official Responses API endpoint. */
  readonly endpoint: typeof OPENAI_WEB_SEARCH_ENDPOINT
  /** Exact JSON body sent to OpenAI. */
  readonly body: OpenAIWebSearchRequestBody
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Secret-free auxiliary OpenAI web search request recorded before dispatch. */
    'web/openai-search-llm-request': OpenAIWebSearchLlmRequest
  }
}

/** Search context sizes accepted by the hosted tool. */
export type OpenAIWebSearchContextSize = 'low' | 'medium' | 'high'

/** Exact request body used for one Responses API search. */
export interface OpenAIWebSearchRequestBody {
  readonly model: string
  readonly input: string
  readonly tools: readonly [{
    readonly type: 'web_search'
    readonly search_context_size: OpenAIWebSearchContextSize
    readonly user_location: {
      readonly type: 'approximate'
      readonly country?: string
    }
  }]
  readonly tool_choice: 'required'
  readonly max_tool_calls: number
  readonly max_output_tokens: number
  readonly include: readonly ['web_search_call.action.sources']
  readonly store: false
}

/** Resolved options captured once at operation entry. */
export interface OpenAIWebSearchProviderOptions {
  /** Resolve the current OpenAI API key for one search operation. */
  readonly resolveApiKey: () => Promise<string | undefined>
  /** Credential reference named by missing-credential diagnostics. */
  readonly apiKeyEnv: CredentialRef
  /** Auxiliary Responses API model. */
  readonly model: string
  /** Hosted search context size. */
  readonly searchContextSize: OpenAIWebSearchContextSize
  /** Generated and reasoning token ceiling. */
  readonly maxOutputTokens: number
  /** Maximum built-in tool calls. */
  readonly maxToolCalls: number
  /** Optional user-supplied ISO 3166-1 alpha-2 country code. */
  readonly country?: string
  /** Request timeout in milliseconds. */
  readonly timeoutMs: number
  /** Record the secret-free request immediately before dispatch. */
  readonly recordRequest?: (request: OpenAIWebSearchLlmRequest) => void
}

/** The OpenAI-backed search provider. */
export class OpenAIWebSearchProvider implements WebSearchProvider {
  readonly id = OPENAI_WEB_SEARCH_PROVIDER_ID
  readonly title = 'OpenAI web search'
  readonly description: NonNullable<WebSearchProvider['description']> = {
    en: 'Runs OpenAI Responses API web search, billed as a web-search tool call plus model tokens. Requires OPENAI_API_KEY.',
    ja: 'OpenAI Responses API の Web 検索を実行し、Web 検索ツール呼び出しとモデルトークンの料金が発生します。OPENAI_API_KEY が必要です。',
    zh: '通过 OpenAI Responses API 执行网页搜索，按网页搜索工具调用和模型 token 计费。需要 OPENAI_API_KEY。',
  }

  /** @param resolveOptions - live options captured once for each operation. */
  constructor(private readonly resolveOptions: () => OpenAIWebSearchProviderOptions) {}

  available(): boolean {
    const options = this.resolveOptions()
    return options.model.length > 0
      && isIntegerAtLeast(options.maxOutputTokens, OPENAI_WEB_SEARCH_MIN_OUTPUT_TOKENS)
      && isPositiveInteger(options.maxToolCalls)
      && isPositiveInteger(options.timeoutMs)
      && (options.country === undefined || /^[A-Za-z]{2}$/.test(options.country))
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const options = this.resolveOptions()
    throwIfAborted(signal)
    const apiKey = await resolveCredential(options.resolveApiKey, signal)
    if (apiKey === undefined || apiKey.length === 0) {
      throw new WebError(
        `OpenAI web search has no API key for "${options.apiKeyEnv}"; store it through the credentials service (the web Models page writes it), or export it in the launching environment`,
        'WEB_PROVIDER_CREDENTIAL_MISSING',
      )
    }
    throwIfAborted(signal)

    const body: OpenAIWebSearchRequestBody = {
      model: options.model,
      input: request.query,
      tools: [{
        type: 'web_search',
        search_context_size: options.searchContextSize,
        // Omission makes the API default to the United States. This explicit empty location sends no inferred location.
        user_location: {
          type: 'approximate',
          ...options.country === undefined ? {} : { country: options.country.toUpperCase() },
        },
      }],
      tool_choice: 'required',
      max_tool_calls: options.maxToolCalls,
      max_output_tokens: options.maxOutputTokens,
      include: ['web_search_call.action.sources'],
      store: false,
    }
    options.recordRequest?.({ endpoint: OPENAI_WEB_SEARCH_ENDPOINT, body })
    throwIfAborted(signal)

    const timed = timedSignal(signal, options.timeoutMs)
    let response: Response
    try {
      response = await fetch(OPENAI_WEB_SEARCH_ENDPOINT, {
        method: 'POST',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: timed.signal,
      })
    } catch (error: unknown) {
      timed.dispose()
      throw transportError(signal, timed.timedOut(), options.timeoutMs, error)
    }

    if (!response.ok) {
      const status = response.status
      let detail: string | undefined
      try {
        detail = openAIErrorDetail(status, await response.json())
      } catch (error: unknown) {
        if (signal?.aborted === true) {
          timed.dispose()
          throw aborted(signal, error)
        }
        if (timed.timedOut()) {
          timed.dispose()
          throw timeoutError(options.timeoutMs, error)
        }
        if (isAbortError(error)) {
          timed.dispose()
          throw providerError('OpenAI response reading was aborted by the HTTP client', error)
        }
      }
      timed.dispose()
      throw providerError(
        `OpenAI Responses API error (HTTP ${status})${detail === undefined || detail.length === 0 ? '' : `: ${detail}`}`,
      )
    }

    try {
      const payload: unknown = await response.json()
      timed.dispose()
      return mapOpenAIResponse(payload)
    } catch (error: unknown) {
      timed.dispose()
      if (signal?.aborted === true) throw aborted(signal, error)
      if (timed.timedOut()) throw timeoutError(options.timeoutMs, error)
      if (isAbortError(error)) throw providerError('OpenAI response reading was aborted by the HTTP client', error)
      if (error instanceof WebError) throw error
      throw providerError(`OpenAI returned an unprocessable response body: ${String(error)}`, error)
    }
  }
}

/**
 * Map completed search calls and URL citations without treating generated prose as search results.
 * @param response - parsed Responses API body.
 * @returns confirmed, URL-bearing sources with citations before uncited search sources.
 */
export function mapOpenAIResponse(response: unknown): WebSearchResult {
  if (!isRecord(response)) throw invalidOpenAIResponse('response must be an object')
  if (response.status !== 'completed') {
    const details = response.incomplete_details
    const reason = isRecord(details) && typeof details.reason === 'string' ? details.reason : undefined
    throw new WebError(
      `OpenAI web search response was not completed${reason === undefined || reason.length === 0 ? '' : `: ${reason}`}`,
      'WEB_PROVIDER_ERROR',
    )
  }
  const output = optionalRecordArray(response.output, 'output')
  const searches: { readonly item: Record<string, unknown>; readonly action: Record<string, unknown> }[] = []
  for (const item of output) {
    if (item.type === 'web_search_call' && isRecord(item.action) && item.action.type === 'search') {
      searches.push({ item, action: item.action })
    }
  }
  if (searches.length === 0) throw new WebError('OpenAI returned no web_search_call search action', 'WEB_PROVIDER_ERROR')
  if (searches.some(call => call.item.status !== 'completed')) {
    throw new WebError('OpenAI returned a web_search_call that was not completed', 'WEB_PROVIDER_ERROR')
  }

  const annotations = new Map<string, OpenAIAnnotation>()
  for (const item of output.filter(item => item.type === 'message')) {
    for (const content of optionalRecordArray(item.content, 'message.content')) {
      for (const annotation of optionalRecordArray(content.annotations, 'message.content.annotations')) {
        if (annotation.type !== 'url_citation') continue
        const url = optionalNullableString(annotation.url, 'url_citation.url')
        const title = optionalNullableString(annotation.title, 'url_citation.title')
        const key = normalizedHttpUrl(url)
        if (key === undefined || typeof url !== 'string') continue
        const existing = annotations.get(key)
        if (existing === undefined) {
          annotations.set(key, { url, title })
        } else if (!hasTitle(existing.title) && hasTitle(title)) {
          annotations.set(key, { url: existing.url, title })
        }
      }
    }
  }

  const sources: WebSearchSource[] = []
  const seen = new Set<string>()
  const add = (rawUrl: string, annotation?: OpenAIAnnotation): void => {
    const key = normalizedHttpUrl(rawUrl)
    if (key === undefined || seen.has(key)) return
    seen.add(key)
    const title = annotation?.title
    sources.push({
      url: rawUrl,
      ...title === undefined || title === null || title.length === 0 ? {} : { title },
    })
  }
  for (const annotation of annotations.values()) add(annotation.url, annotation)
  for (const call of searches) {
    for (const source of optionalRecordArray(call.action.sources, 'web_search_call.action.sources')) {
      const url = optionalNullableString(source.url, 'web_search_call.action.sources[].url')
      const key = normalizedHttpUrl(url)
      if (key !== undefined && typeof url === 'string') add(url, annotations.get(key))
    }
  }
  return { sources, truncated: false }
}

interface OpenAIAnnotation {
  readonly url: string
  readonly title: string | null | undefined
}

/** Whether a citation title can label its source. */
function hasTitle(title: string | null | undefined): title is string {
  return typeof title === 'string' && title.length > 0
}

/** Read the small, non-secret error detail fields OpenAI documents. */
function openAIErrorDetail(status: number, value: unknown): string | undefined {
  if (status === 401 || status === 403) return undefined
  if (!isRecord(value)) return undefined
  const error = value.error
  if (!isRecord(error)) return undefined
  for (const field of ['code', 'type']) {
    const detail = error[field]
    if (typeof detail === 'string') return detail
  }
  return undefined
}

/** Require an optional JSON field to be an array of objects when present. */
function optionalRecordArray(value: unknown, field: string): readonly Record<string, unknown>[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.some(item => !isRecord(item))) {
    throw invalidOpenAIResponse(`${field} must be an array of objects`)
  }
  return value.filter(isRecord)
}

/** Require one optional wire string to retain its documented nullable shape. */
function optionalNullableString(value: unknown, field: string): string | null | undefined {
  if (value === undefined || value === null || typeof value === 'string') return value
  throw invalidOpenAIResponse(`${field} must be a string or null`)
}

/** Build a response-shape failure without echoing provider data. */
function invalidOpenAIResponse(detail: string): WebError {
  return new WebError(`OpenAI returned an invalid response: ${detail}`, 'WEB_PROVIDER_ERROR')
}

/** Narrow an untrusted JSON value to an ordinary object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Resolve a credential while preserving caller cancellation. */
async function resolveCredential(
  resolve: () => Promise<string | undefined>, signal?: AbortSignal,
): Promise<string | undefined> {
  throwIfAborted(signal)
  try {
    return await abortable(resolve(), signal)
  } catch (error: unknown) {
    if (signal?.aborted === true || isAbortError(error)) throw aborted(signal, error)
    throw new WebError(`OpenAI web search credential resolution failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
}

/** Build one timeout controller that also follows caller cancellation. */
function timedSignal(signal: AbortSignal | undefined, timeoutMs: number): {
  readonly signal: AbortSignal
  readonly timedOut: () => boolean
  readonly dispose: () => void
} {
  const controller = new AbortController()
  let didTimeout = false
  const onAbort = (): void => { controller.abort(signal?.reason) }
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => {
    didTimeout = true
    controller.abort(new DOMException('OpenAI web search timed out', 'TimeoutError'))
  }, timeoutMs)
  return {
    signal: controller.signal,
    timedOut: () => didTimeout,
    dispose: () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    },
  }
}

/** Convert one transport failure without exposing credentials or query text. */
function transportError(signal: AbortSignal | undefined, timedOut: boolean, timeoutMs: number, error: unknown): WebError {
  if (signal?.aborted === true) return aborted(signal, error)
  if (timedOut) return timeoutError(timeoutMs, error)
  return providerError(`OpenAI web search request failed: ${String(error)}`, error)
}

/** Report a timeout without request data. */
function timeoutError(timeoutMs: number, cause?: unknown): WebError {
  return providerError(`OpenAI web search request timed out after ${timeoutMs} ms`, cause)
}

/** Add actionable recovery guidance without exposing request data. */
function providerError(message: string, cause?: unknown): WebError {
  return new WebError(
    `${message}\n\nThe request used the fixed official OpenAI Responses API endpoint. Check the OpenAI key, billing limits, and model access; failed searches are not retried or sent to another provider.`,
    'WEB_PROVIDER_ERROR',
    cause === undefined ? undefined : { cause },
  )
}

/** Normalize valid HTTP(S) URLs for deduplication. */
function normalizedHttpUrl(value: string | null | undefined): string | undefined {
  if (value === undefined || value === null || value.length === 0) return undefined
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : undefined
  } catch (_invalidUrl) {
    return undefined
  }
}

/** Reject an already-aborted search. */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw aborted(signal)
}

/** Map caller cancellation to the shared web code. */
function aborted(signal?: AbortSignal, cause?: unknown): WebError {
  return new WebError('OpenAI web search was aborted', 'WEB_ABORTED', { cause: cause ?? signal?.reason })
}

/** Whether an unknown native fetch failure is an abort. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** Race a resolver against caller cancellation. */
function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation
  /* v8 ignore next -- resolveCredential checks this signal immediately before starting the operation. */
  if (signal.aborted) return Promise.reject(aborted(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { reject(aborted(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    void operation.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value) },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

/** Whether a numeric setting is a positive integer. */
function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

/** Whether a numeric setting is an integer at or above its protocol minimum. */
function isIntegerAtLeast(value: number, minimum: number): boolean {
  return Number.isInteger(value) && value >= minimum
}

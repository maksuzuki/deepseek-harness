/**
 * Durable pi-ai replay metadata and assistant-history reconstruction.
 *
 * Harness content remains the durable source for text and tool calls. This
 * module stores only the provider-native metadata needed to reconstruct a
 * pi-ai assistant message on a later request.
 *
 * @module dsh-llm-pi-ai/replay
 */

import { LlmError } from '@deepseek-ai/dsh-llm'
import type { AssistantMessage as HarnessAssistantMessage, ModelMessageSource, ReplayEnvelope } from '@deepseek-ai/dsh-llm'
import type { Api, AssistantMessage, ToolCall, Usage as PiUsage } from '@earendil-works/pi-ai'
import { calculateContextTokens } from '@earendil-works/pi-ai/utils/estimate'
import type { PrefixDigests, UsageDigests } from './prefix-binding.ts'

/** Per-block half of the pi-ai replay envelope, one entry per content block. */
export type PiAiReplayBlock =
  | { type: 'text'; textSignature?: string }
  | { type: 'reasoning'; thinkingSignature?: string; redacted?: boolean }
  | { type: 'tool-call'; thoughtSignature?: string; namespace?: string }

/** Validated provider counts reusable only within the same compaction revision. */
interface PiAiReplayUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  totalTokens: number
}

/** Versioned response-level half of the pi-ai replay envelope. */
export interface PiAiReplayResponse {
  kind: 'pi-ai'
  version: 2
  api: Api
  provider: string
  /** Requested model identity, matching the durable assistant source. */
  model: string
  /** Provider-reported model; replay retains the requested model for signature matching. */
  responseModel?: string
  responseId?: string
  /** Provider-native effort for historical replay; absence is preserved. */
  providerThinkingLevel?: string
  /** Optional counts from the producing request. */
  usage?: PiAiReplayUsage
  /** Latest checkpoint included in the producing request. */
  contextRevision?: string
  /** Request prefix and model identity that reported this usage. */
  usagePrefixDigest?: string
  stopReason: AssistantMessage['stopReason']
  /** Digest of the request context this response was generated from; see `prefix-binding.ts`. */
  prefixDigest?: string
}

/** The validated halves of one pi-ai replay envelope. */
interface PiAiReplayState {
  response: PiAiReplayResponse
  blocks: PiAiReplayBlock[]
}

/** Parse tool-call argument JSON; tolerate model malformations with {}. */
function parseArguments(raw: string): ToolCall['arguments'] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as ToolCall['arguments']
    }
  } catch {
    // fall through
  }
  return {}
}

/** Construct the zero usage value required by historical pi-ai messages. */
function emptyPiUsage(): PiUsage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

/** Restore validated counts without replaying provider cost estimates. */
function replayUsage(usage?: PiAiReplayUsage): PiUsage {
  return {
    input: usage?.input ?? 0,
    output: usage?.output ?? 0,
    cacheRead: usage?.cacheRead ?? 0,
    cacheWrite: usage?.cacheWrite ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

/** Keep only complete, positive counts reported by pi-ai. */
function replayUsageOf(usage: PiUsage): PiAiReplayUsage | undefined {
  const values = [usage.input, usage.output, usage.cacheRead, usage.cacheWrite, usage.totalTokens]
  if (values.some(value => !Number.isSafeInteger(value) || value < 0)) return undefined
  if (usage.totalTokens > 0 && usage.totalTokens < usage.input + usage.output + usage.cacheRead + usage.cacheWrite) return undefined
  if (calculateContextTokens(usage) <= 0) return undefined
  return { input: usage.input, output: usage.output, cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite, totalTokens: usage.totalTokens }
}

/**
 * Project a successful pi-ai response into the minimal durable replay state.
 * The per-block half is index-aligned with the streamed blocks (pi-ai content
 * order), so `BlockAssembler` prunes an entry with its block whenever assembly
 * removes one.
 * @param message - completed native pi-ai assistant response.
 * @param requestedModel - request identity stored in the assistant source; defaults to the native model.
 * @param prefixDigest - digest of the request context, recorded when the protocol binds thinking to it.
 * @param contextRevision - latest checkpoint included in the completed request.
 * @param usagePrefixDigest - digest of the completed request's converted prefix and model identity.
 * @returns the versioned lossless-JSON replay projection.
 */
export function toPiReplayState(
  message: AssistantMessage,
  requestedModel = message.model,
  prefixDigest?: string,
  contextRevision?: string,
  usagePrefixDigest?: string,
): ReplayEnvelope {
  const usage = replayUsageOf(message.usage)
  const response: PiAiReplayResponse = {
    kind: 'pi-ai',
    version: 2,
    api: message.api,
    provider: message.provider,
    model: requestedModel,
    ...message.responseModel === undefined ? {} : { responseModel: message.responseModel },
    ...message.responseId === undefined ? {} : { responseId: message.responseId },
    ...message.providerThinkingLevel === undefined ? {} : { providerThinkingLevel: message.providerThinkingLevel },
    ...usage === undefined ? {} : { usage },
    ...contextRevision === undefined ? {} : { contextRevision },
    ...usage === undefined || usagePrefixDigest === undefined ? {} : { usagePrefixDigest },
    stopReason: message.stopReason,
    ...prefixDigest === undefined ? {} : { prefixDigest },
  }
  return {
    response,
    blocks: message.content.map((block): PiAiReplayBlock => {
      switch (block.type) {
        case 'text': return {
          type: 'text',
          ...block.textSignature === undefined ? {} : { textSignature: block.textSignature },
        }
        case 'thinking': return {
          type: 'reasoning',
          ...block.thinkingSignature === undefined ? {} : { thinkingSignature: block.thinkingSignature },
          ...block.redacted === undefined ? {} : { redacted: block.redacted },
        }
        case 'toolCall': return {
          type: 'tool-call',
          ...block.thoughtSignature === undefined ? {} : { thoughtSignature: block.thoughtSignature },
          ...block.namespace === undefined ? {} : { namespace: block.namespace },
        }
      }
    }),
  }
}

function invalidReplay(message: string): never {
  throw new LlmError(`invalid pi-ai replay state: ${message}`, 'INVALID_REPLAY_STATE')
}

/** Validate the durable adapter-private envelope before it reaches pi-ai. */
function readReplayState(value: unknown): PiAiReplayState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalidReplay('expected a replay envelope')
  const envelope = value as Record<string, unknown>
  const rawResponse = envelope['response']
  if (typeof rawResponse !== 'object' || rawResponse === null || Array.isArray(rawResponse)) return invalidReplay('expected a response object')
  const response = rawResponse as Record<string, unknown>
  if (response['kind'] !== 'pi-ai') return invalidReplay('unknown state kind')
  if (response['version'] !== 2) return invalidReplay(`unsupported version ${String(response['version'])}`)
  for (const key of ['api', 'provider', 'model'] as const) {
    if (typeof response[key] !== 'string' || response[key].length === 0) return invalidReplay(`${key} must be a non-empty string`)
  }
  if (!['stop', 'length', 'toolUse', 'error', 'aborted'].includes(String(response['stopReason']))) {
    return invalidReplay('unknown stopReason')
  }
  if (response['responseModel'] !== undefined && typeof response['responseModel'] !== 'string') return invalidReplay('responseModel must be a string')
  if (response['responseId'] !== undefined && typeof response['responseId'] !== 'string') return invalidReplay('responseId must be a string')
  if (response['providerThinkingLevel'] !== undefined && typeof response['providerThinkingLevel'] !== 'string') return invalidReplay('providerThinkingLevel must be a string')
  if (response['prefixDigest'] !== undefined && typeof response['prefixDigest'] !== 'string') return invalidReplay('prefixDigest must be a string')
  if (response['contextRevision'] !== undefined && (typeof response['contextRevision'] !== 'string' || response['contextRevision'].length === 0)) return invalidReplay('contextRevision must be a non-empty string')
  if (response['usagePrefixDigest'] !== undefined
    && (typeof response['usagePrefixDigest'] !== 'string' || !/^[0-9a-f]{64}$/.test(response['usagePrefixDigest']))) {
    return invalidReplay('usagePrefixDigest must be a SHA-256 hex digest')
  }
  const rawUsage = response['usage']
  if (rawUsage !== undefined) {
    if (typeof rawUsage !== 'object' || rawUsage === null || Array.isArray(rawUsage)) return invalidReplay('usage must be an object')
    const usage = rawUsage as Record<string, unknown>
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens'] as const) {
      if (typeof usage[key] !== 'number' || !Number.isSafeInteger(usage[key]) || usage[key] < 0) {
        return invalidReplay(`usage ${key} must be a non-negative safe integer`)
      }
    }
    const counts = usage as Record<keyof PiAiReplayUsage, number>
    if (counts.totalTokens > 0 && counts.totalTokens < counts.input + counts.output + counts.cacheRead + counts.cacheWrite) {
      return invalidReplay('usage totalTokens must cover its components')
    }
    if (calculateContextTokens(replayUsage(counts)) <= 0) return invalidReplay('usage must report positive context tokens')
  }
  const blocks = envelope['blocks']
  if (!Array.isArray(blocks)) return invalidReplay('blocks must be an array')
  for (const [index, value] of blocks.entries()) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalidReplay(`block ${index} must be an object`)
    const block = value as Record<string, unknown>
    if (!['text', 'reasoning', 'tool-call'].includes(String(block['type']))) return invalidReplay(`block ${index} has an unknown type`)
    for (const signature of ['textSignature', 'thinkingSignature', 'thoughtSignature', 'namespace'] as const) {
      if (block[signature] !== undefined && typeof block[signature] !== 'string') return invalidReplay(`block ${index} ${signature} must be a string`)
    }
    if (block['redacted'] !== undefined && typeof block['redacted'] !== 'boolean') return invalidReplay(`block ${index} redacted must be boolean`)
  }
  return {
    response: response as unknown as PiAiReplayResponse,
    blocks: blocks as PiAiReplayBlock[],
  }
}

/** Convert provider-neutral blocks without trusting them as same-model replay. */
function foreignAssistant(message: HarnessAssistantMessage): AssistantMessage {
  const source = message.source
  const content: AssistantMessage['content'] = []
  for (const block of message.content) {
    switch (block.type) {
      case 'text': content.push({ type: 'text', text: block.text }); break
      case 'reasoning': content.push({ type: 'thinking', thinking: block.text }); break
      case 'tool-call': content.push({
        type: 'toolCall',
        id: block.id,
        name: block.name,
        arguments: parseArguments(block.arguments),
      }); break
      case 'image':
        throw new LlmError('pi-ai chat history cannot represent structured assistant image output', 'UNSUPPORTED_CONTENT')
      default:
        // plugin-added block types are not representable in pi-ai.
        break
    }
  }
  return {
    role: 'assistant',
    content,
    // Deliberately never equals a catalog API: absent replay state is foreign
    // even if source names the same provider/model as this request.
    api: 'dsh-foreign',
    provider: source.provider,
    model: source.model,
    usage: emptyPiUsage(),
    stopReason: content.some(piece => piece.type === 'toolCall') ? 'toolUse' : 'stop',
    timestamp: 0,
  }
}

/** Recombine durable Harness content with validated pi-ai replay metadata. */
function replayedAssistant(
  message: HarnessAssistantMessage,
  source: ModelMessageSource,
  rawState: unknown,
  prefixDigests?: PrefixDigests,
  usageDigests?: UsageDigests,
  contextRevision?: string,
): AssistantMessage {
  const state = readReplayState(rawState)
  if (state.response.provider !== source.provider) return invalidReplay('provider does not match assistant source')
  if (state.response.model !== source.model) return invalidReplay('model does not match assistant source')
  if (state.blocks.length !== message.content.length) return invalidReplay('block count does not match assistant content')
  const content: AssistantMessage['content'] = message.content.map((block, index) => {
    const replay = state.blocks[index]
    if (replay === undefined || replay.type !== block.type) return invalidReplay(`block ${index} does not match assistant content`)
    switch (block.type) {
      case 'text': return {
        type: 'text',
        text: block.text,
        ...replay.type === 'text' && replay.textSignature !== undefined ? { textSignature: replay.textSignature } : {},
      }
      case 'reasoning': return {
        type: 'thinking',
        thinking: block.text,
        ...replay.type === 'reasoning' && replay.thinkingSignature !== undefined ? { thinkingSignature: replay.thinkingSignature } : {},
        ...replay.type === 'reasoning' && replay.redacted !== undefined ? { redacted: replay.redacted } : {},
      }
      case 'tool-call': return {
        type: 'toolCall',
        id: block.id,
        name: block.name,
        arguments: parseArguments(block.arguments),
        ...replay.type === 'tool-call' && replay.thoughtSignature !== undefined ? { thoughtSignature: replay.thoughtSignature } : {},
        ...replay.type === 'tool-call' && replay.namespace !== undefined ? { namespace: replay.namespace } : {},
      }
      /* v8 ignore next -- readReplayState rejects unknown replay tags, so an equal plugin-added Harness tag cannot reach this switch */
      default: return invalidReplay(`block ${index} has an unsupported Harness type`)
    }
  })
  const assistant: AssistantMessage = {
    role: 'assistant',
    content,
    api: state.response.api,
    provider: state.response.provider,
    model: state.response.model,
    ...state.response.responseModel === undefined ? {} : { responseModel: state.response.responseModel },
    ...state.response.responseId === undefined ? {} : { responseId: state.response.responseId },
    ...state.response.providerThinkingLevel === undefined ? {} : { providerThinkingLevel: state.response.providerThinkingLevel },
    usage: replayUsage(state.response.contextRevision === contextRevision ? state.response.usage : undefined),
    stopReason: state.response.stopReason,
    timestamp: 0,
  }
  if (state.response.prefixDigest !== undefined) prefixDigests?.set(assistant, state.response.prefixDigest)
  if (state.response.usagePrefixDigest !== undefined) usageDigests?.set(assistant, state.response.usagePrefixDigest)
  return assistant
}

/**
 * Convert one durable Harness assistant message into pi-ai history.
 *
 * Durable content is the authoritative record; replay metadata only restores
 * native fidelity (ids, signatures). A replay state this build cannot use —
 * another adapter's kind, another version, a malformed value, or metadata that
 * no longer matches the content — therefore degrades the one message to
 * provider-neutral history instead of failing the request.
 * @param message - model-produced assistant content with provider, model, and optional adapter-owned replay metadata.
 * @param onDegrade - called with the diagnostic reason when an unusable replay
 *   state falls back to provider-neutral conversion.
 * @param prefixDigests - receives the recorded request-prefix digest of the returned message, when replay state has one.
 * @param contextRevision - latest checkpoint in the current request; mismatched usage is discarded.
 * @param usageDigests - receives the recorded digest of replayed usage, when present.
 * @returns a native pi-ai assistant message reconstructed from durable content.
 */
export function toPiAssistant(
  message: HarnessAssistantMessage,
  onDegrade?: (reason: string) => void,
  prefixDigests?: PrefixDigests,
  contextRevision?: string,
  usageDigests?: UsageDigests,
): AssistantMessage {
  const source = message.source
  if (source.replayState === undefined) return foreignAssistant(message)
  try {
    return replayedAssistant(message, source, source.replayState, prefixDigests, usageDigests, contextRevision)
  } catch (error: unknown) {
    /* v8 ignore next -- replayedAssistant throws only INVALID_REPLAY_STATE LlmErrors; the
       guard keeps a future non-replay failure loud instead of silently degrading it */
    if (!(error instanceof LlmError) || error.code !== 'INVALID_REPLAY_STATE') throw error
    onDegrade?.(error.message)
    return foreignAssistant(message)
  }
}

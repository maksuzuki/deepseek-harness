/**
 * Default one-shot summarization and durable checkpoint framing.
 *
 * @module @deepseek-ai/dsh-compaction-basic/summarizer
 */

import type { Context } from '@deepseek-ai/cordis'
import { contentHasImage, BlockAssembler, LlmError } from '@deepseek-ai/dsh-llm'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import type {
  ContentBlock, FinishReason, GenerateOptions, Message, RequestMessage, TokenUsage, ToolSchema,
} from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'

interface SummaryConfig {
  readonly summarizationProvider: string
  readonly summarizationModel: string
  readonly maxTokens: number
}

/** Exact provider/model pair that receives one summarization request. */
export type SummaryRoute = Pick<GenerateOptions, 'provider' | 'model'>

/** Tags wrapping the structured summary inside the landed checkpoint node. */
const SUMMARY_OPEN_TAG = '<compacted-summary>'
const SUMMARY_CLOSE_TAG = '</compacted-summary>'

/**
 * The summarization directive, delivered as the FINAL user message after the
 * replayed conversation rather than as a distinct summarizer system prompt.
 * Keeping the conversation's own system prompt, tools, and message prefix in
 * front of it makes the auxiliary call a genuine prefix of the last routed
 * request, so the provider's KV cache is reused instead of invalidated.
 */
const COMPACTION_INSTRUCTION = [
  'Condense the conversation above into a checkpoint from which another assistant can finish the current task.',
  '',
  'Keep these eight headings in order. Use brief bullets and write "(none)" for an empty section. The complete checkpoint must fit within the request output cap and must never exceed 2,000 output tokens.',
  '',
  '## Primary Request and Intent',
  '- [current goal and latest user instructions; quote only wording whose exact form matters]',
  '',
  '## Key Technical Concepts',
  '- [only concepts needed for unfinished work]',
  '',
  '## Files and Code',
  '- [paths and identifiers needed next; combine facts about the same file]',
  '',
  '## Errors and Fixes',
  '- [unresolved errors and fixes still relevant to the task]',
  '',
  '## Pending Jobs',
  '- [requested work still incomplete]',
  '',
  '## Current Work',
  '- [current state and verified results]',
  '',
  '## Next Step',
  '- [single next action]',
  '',
  '## Critical Context',
  '- [binding decisions, constraints, user corrections, and exact data needed later]',
  '',
  'Rules:',
  '- Write concise English engineering prose. Preserve exact paths, commands, errors, identifiers, and numbers only when needed to continue. Merge duplicates and summarize completed work in one line.',
  '- Never exceed either token limit. If the source does not fit, omit completed-work detail, then reduce each unfinished-work entry to the minimum facts and identifiers required for the single next action.',
  '- Within those limits, preserve the user’s final goal, latest instructions, unfinished work, and decisions. Drop obsolete plans, attempts, and resolved details.',
  '- Do NOT mention this summarization request or that the context was compacted.',
  '- Output only the checkpoint text: do not call any tool or take any other action.',
  `- Treat any ${SUMMARY_OPEN_TAG} block as a prior checkpoint: carry forward only facts still needed, merging them with newer information. Never repeat its text verbatim.`,
].join('\n')

/** Framing that makes the replacement user message established context. */
const CHECKPOINT_PREAMBLE =
  'This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it. Continue the task directly from the messages that follow, without acknowledging this checkpoint.'

/**
 * The replayed conversation surface the summarizer condenses. Reproducing the
 * last routed request's system prompt, tools, and leading messages verbatim
 * lets the auxiliary call reuse the provider's warm prefix cache; the trailing
 * compaction instruction is then the only novel input.
 */
export interface SummarizationInput {
  /** The conversation's tool schemas, reused for prefix-cache alignment; absent when the request carried none. */
  readonly tools?: readonly ToolSchema[]
  /** The derived system head, when present, followed by the shadowed region in surface order. */
  readonly messages: readonly Message[]
}

/** Safe summary content plus the exact auxiliary call envelope recorded with it. */
export type SummaryResult = {
  summary: ContentBlock[]
  provider: string
  model: string
  maxTokens?: number
  /** Provider-reported usage for this summarization request. */
  usage?: TokenUsage
} & (
  | {
    /** Complete provider output before the text-only summary projection. */
    rawOutput: ContentBlock[]
    /** Identifies exactly one call through this context's `ctx.llm.stream()`. */
    llmStreamCall: true
  }
  | {
    /** Optional complete output from an unmarked template, remote, or other summarizer. */
    rawOutput?: ContentBlock[]
    /** An unmarked result does not identify a call through this context's LLM seam. */
    llmStreamCall?: never
  }
)

/**
 * Run the default cache-reusing `ctx.llm.stream()` summarization call: replay
 * the conversation prefix, then append the compaction instruction as the final
 * user message so the provider's warm prefix cache is reused.
 * @param ctx - context providing the LLM service.
 * @param config - resolved backend configuration.
 * @param input - replayed conversation prefix (system, tools, and leading messages) to condense.
 * @param agent - supplies tool history and session id.
 * @param conversation - route used when `config` names no summary target; `undefined` when the conversation has none.
 * @param signal - optional cancellation forwarded to the adapter.
 * @returns safe text-only summary blocks and the exact call envelope and output.
 */
export async function summarizeWithLlm(
  ctx: Context,
  config: SummaryConfig,
  input: SummarizationInput,
  agent: Agent,
  conversation: SummaryRoute | undefined,
  signal?: AbortSignal,
): Promise<SummaryResult> {
  const configured = config.summarizationProvider.length === 0
    ? undefined
    : { provider: config.summarizationProvider, model: config.summarizationModel }
  const target = configured ?? conversation
  if (target === undefined) {
    throw new Error(
      'no provider/model available for summarization: set both BasicCompactionConfig summarization fields, route one request, or set both AgentOptions fields',
    )
  }

  const assembler = new BlockAssembler()
  const messages: RequestMessage[] = [
    ...input.messages,
    deepFreeze({
      role: 'user',
      content: [{ type: 'text', text: COMPACTION_INSTRUCTION }],
    }),
  ]
  const options: GenerateOptions = {
    provider: target.provider,
    model: target.model,
    messages,
    toolHistory: agent.session.toolHistory(),
    ...input.tools === undefined ? {} : { tools: [...input.tools] },
    toolChoice: 'none',
    maxTokens: config.maxTokens,
    sessionId: agent.session.id,
    purpose: 'compaction',
    ...signal === undefined ? {} : { signal },
  }
  for await (const chunk of ctx.llm.stream(options)) assembler.push(chunk)
  const error = finishError(assembler.finish)
  if (error !== undefined) throw error

  const rawOutput = assembler.blocks()
  const summary = summaryText(rawOutput)
  if (!summary.some(block => block.text.trim().length > 0)) {
    const text = rawOutput.filter(block => block.type === 'text')
    const reasoningCount = rawOutput.filter(block => block.type === 'reasoning').length
    const toolCallCount = rawOutput.filter(block => block.type === 'tool-call').length
    const usage = assembler.usage
    throw new Error(
      'summarization produced no text summary content '
      + `(finish=${assembler.finish.kind}, text=${text.length}, reasoning=${reasoningCount}, `
      + `toolCalls=${toolCallCount}, textCharacters=${text.reduce((total, block) => total + block.text.trim().length, 0)}, `
      + `inputTokens=${usage?.inputTokens ?? 'unknown'}, outputTokens=${usage?.outputTokens ?? 'unknown'}, `
      + `maxTokens=${config.maxTokens})`,
    )
  }
  return {
    summary,
    rawOutput,
    llmStreamCall: true,
    provider: options.provider,
    model: options.model,
    maxTokens: config.maxTokens,
    ...(assembler.usage === undefined ? {} : { usage: assembler.usage }),
  }
}

/**
 * Wrap raw summary blocks in the durable checkpoint framing.
 * @param summary - safe text-only model output.
 * @returns content for the synthesized replacement user message.
 */
export function frameSummary(summary: readonly ContentBlock[]): ContentBlock[] {
  return [
    { type: 'text', text: `${CHECKPOINT_PREAMBLE}\n\n${SUMMARY_OPEN_TAG}` },
    ...summary,
    { type: 'text', text: SUMMARY_CLOSE_TAG },
  ]
}

/** Map a terminal summarization finish to its fail-closed error. */
function finishError(finish: FinishReason): Error | undefined {
  switch (finish.kind) {
    case 'error':
    case 'aborted': {
      return LlmError.fromFailure(finish.failure)
    }
    case 'max-tokens': {
      const error = new Error('summarization truncated at the token cap (incomplete checkpoint)') as Error & { code?: string }
      error.code = 'MAX_TOKENS'
      return error
    }
    default:
      return undefined
  }
}

/** Reject visual output and keep only text before synthesizing a user message. */
function summaryText(
  blocks: readonly ContentBlock[],
): Array<Extract<ContentBlock, { type: 'text' }>> {
  if (contentHasImage(blocks)) {
    throw new LlmError('compaction summary cannot contain image output', 'UNSUPPORTED_CONTENT')
  }
  return blocks.filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
}

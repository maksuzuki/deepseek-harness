/**
 * DSH-owned checks around pi-ai's estimated context budget.
 * @module dsh-llm-pi-ai/context-budget
 */

import type { Api, Context, Model } from '@earendil-works/pi-ai'
import { clampMaxTokensToContext } from '@earendil-works/pi-ai/api/simple-options'
import { estimateContextTokens } from '@earendil-works/pi-ai/utils/estimate'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import { CONTEXT_WINDOW_EXCEEDED_CODE, LlmError } from '@deepseek-ai/dsh-llm'

const MIN_USEFUL_OUTPUT_TOKENS = 1

/**
 * Refuse requests for which pi-ai's fixed safety reserve leaves no useful output.
 *
 * @param model - resolved pi-ai model descriptor.
 * @param context - final pi-ai transcript sent to the provider adapter.
 * A one-token inference is rejected even when the caller explicitly requests
 * one token; DSH does not treat that output size as a useful model operation.
 *
 * @param requestedMaxTokens - caller cap, or the model cap when none was supplied; retained in the diagnostic.
 */
export function assertUsefulContextCapacity(
  model: Model<Api>,
  context: Context,
  requestedMaxTokens: number,
): void {
  const transcript = normalizeContext(context)
  const adjustedMaxTokens = clampMaxTokensToContext(model, transcript, requestedMaxTokens)
  if (adjustedMaxTokens > MIN_USEFUL_OUTPUT_TOKENS) return
  const estimatedInput = estimateContextTokens(transcript).tokens
  throw new LlmError(
    `pi-ai context budget for model "${model.id}" has no useful output capacity: estimated ${estimatedInput} input in a ${model.contextWindow}-token window reduces requested ${requestedMaxTokens} output tokens to ${adjustedMaxTokens}`,
    CONTEXT_WINDOW_EXCEEDED_CODE,
  )
}

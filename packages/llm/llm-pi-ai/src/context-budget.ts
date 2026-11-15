/** Estimated pi-ai request admission using its provider-independent safety reserve. @module dsh-llm-pi-ai/context-budget */

import type { Api, Context, Model } from '@earendil-works/pi-ai'
import { clampMaxTokensToContext } from '@earendil-works/pi-ai/api/simple-options'
import { estimateContextTokens } from '@earendil-works/pi-ai/utils/estimate'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import { CONTEXT_WINDOW_EXCEEDED_CODE, LlmError } from '@deepseek-ai/dsh-llm'

/** Reject an inference when pi-ai's normalized transcript and safety reserve leave at most one output token.
 * @param model - resolved model with its context and output limits.
 * @param context - final context after all adapter conversions.
 * @param requestedMaxTokens - explicit output cap or the model default.
 */
export function assertUsefulContextCapacity(model: Model<Api>, context: Context, requestedMaxTokens: number): void {
  const transcript = normalizeContext(context)
  const adjusted = clampMaxTokensToContext(model, transcript, requestedMaxTokens)
  if (adjusted > 1) return
  const estimatedInput = estimateContextTokens(transcript).tokens
  throw new LlmError(
    `pi-ai context budget for model "${model.id}" has no useful output capacity: estimated ${estimatedInput} input in a ${model.contextWindow}-token window reduces requested ${requestedMaxTokens} output tokens to ${adjusted}`,
    CONTEXT_WINDOW_EXCEEDED_CODE,
  )
}

import { describe, expect, it } from 'vitest'
import type { Model, Tool, TranscriptContext } from '@earendil-works/pi-ai'
import { clampMaxTokensToContext } from '@earendil-works/pi-ai/api/simple-options'
import { estimateContextTokens, estimateMessageTokens, estimateTextTokens } from '@earendil-works/pi-ai/utils/estimate'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import { CONTEXT_WINDOW_EXCEEDED_CODE, LlmError } from '@deepseek-ai/dsh-llm'
import { assertUsefulContextCapacity } from '../src/context-budget.ts'

const STANDARD_TOOL_COUNT = 31
const STANDARD_TOOLS_JSON_CHARS = 30_650

function model(contextWindow = 16_384): Model<'openai-completions'> {
  return {
    id: 'vision-16k',
    name: 'Vision 16K',
    api: 'openai-completions',
    provider: 'gateway',
    baseUrl: 'http://127.0.0.1/unused',
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens: 2048,
  }
}

function standardTools(): Tool[] {
  const tools = Array.from({ length: STANDARD_TOOL_COUNT }, (_, index): Tool => ({
    name: `standard_${index}`,
    description: 'Standard tool',
    parameters: {
      type: 'object',
      properties: {
        value: { type: 'string', description: 'Input value' },
      },
    },
  }))
  const missing = STANDARD_TOOLS_JSON_CHARS - JSON.stringify(tools).length
  if (missing < 0) throw new Error('standard tool fixture exceeded its captured JSON size')
  tools[tools.length - 1]!.description += 'x'.repeat(missing)
  return tools
}

function capturedVisionContext(): TranscriptContext {
  return normalizeContext({
    systemPrompt: 's'.repeat(5868),
    tools: standardTools(),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', data: '', mimeType: 'image/png' },
          { type: 'text', text: 'u'.repeat(26) },
        ],
        timestamp: 0,
      },
      { role: 'user', content: 'u'.repeat(745), timestamp: 0 },
      { role: 'user', content: 'u'.repeat(1004), timestamp: 0 },
      { role: 'user', content: 'u'.repeat(256), timestamp: 0 },
    ],
  })
}

function textContext(estimatedTokens: number): TranscriptContext {
  return normalizeContext({
    messages: [{ role: 'user', content: 'u'.repeat(Math.floor(estimatedTokens * 3.5)), timestamp: 0 }],
  })
}

function priorUsageWithToolResult(resultChars: number): TranscriptContext {
  return normalizeContext({
    messages: [
      {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'call-1', name: 'inspect', arguments: {} }],
        api: 'openai-completions',
        provider: 'gateway',
        model: 'vision-16k',
        usage: {
          input: 10_172,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 10_172,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'toolUse',
        timestamp: 0,
      },
      {
        role: 'toolResult',
        toolCallId: 'call-1',
        toolName: 'inspect',
        content: [{ type: 'text', text: 'r'.repeat(resultChars) }],
        isError: false,
        timestamp: 0,
      },
    ],
  })
}

describe('pi-ai context output budget', () => {
  it('reproduces the captured Vision estimate and refuses to discard the safety reserve', () => {
    const context = capturedVisionContext()
    const system = context.messages[0]!
    const history = context.messages.slice(1)

    expect(estimateTextTokens('s'.repeat(5868))).toBe(1677)
    expect(estimateMessageTokens(system) - estimateTextTokens('s'.repeat(5868))).toBe(8758)
    expect(history.map(estimateMessageTokens)).toEqual([1379, 213, 287, 74])
    expect(estimateContextTokens(context).tokens).toBe(12_388)
    expect(() => { assertUsefulContextCapacity(model(), context, 2048) }).toThrow(expect.objectContaining({
      code: CONTEXT_WINDOW_EXCEEDED_CODE,
      message: 'pi-ai context budget for model "vision-16k" has no useful output capacity: estimated 12388 input in a 16384-token window reduces requested 2048 output tokens to 1',
    }))
    expect(clampMaxTokensToContext(model(), context, 2048)).toBe(1)
  })

  it('uses exact prior usage and clamps as tool results increase the trailing estimate', () => {
    const context = priorUsageWithToolResult(238)

    expect(estimateContextTokens(context)).toMatchObject({ tokens: 10_240, usageTokens: 10_172, trailingTokens: 68 })
    expect(() => { assertUsefulContextCapacity(model(), context, 2048) }).not.toThrow()
    expect(clampMaxTokensToContext(model(), context, 2048)).toBe(2048)

    const grown = priorUsageWithToolResult(245)
    expect(estimateContextTokens(grown).tokens).toBe(10_242)
    expect(() => { assertUsefulContextCapacity(model(), grown, 2048) }).not.toThrow()
    expect(clampMaxTokensToContext(model(), grown, 2048)).toBe(2046)
  })

  it('retains the safety clamp when it leaves output room', () => {
    const context = textContext(12_000)

    expect(estimateContextTokens(context).tokens).toBe(12_000)
    expect(clampMaxTokensToContext(model(), context, 6000)).toBe(288)
  })

  it('absorbs an underestimate up to the fixed reserve', () => {
    const context = textContext(8000)
    const actualInput = 12_096

    expect(actualInput - estimateContextTokens(context).tokens).toBe(4096)
    expect(() => { assertUsefulContextCapacity(model(), context, 6000) }).not.toThrow()
    const output = clampMaxTokensToContext(model(), context, 6000)
    expect(output).toBe(4288)
    expect(actualInput + output).toBe(16_384)
  })

  it('keeps the requested output only at the safety-adjusted context boundary', () => {
    const context = textContext(10_240)

    expect(estimateContextTokens(context).tokens + 4096 + 2048).toBe(16_384)
    expect(() => { assertUsefulContextCapacity(model(), context, 2048) }).not.toThrow()
    expect(clampMaxTokensToContext(model(), context, 2048)).toBe(2048)
  })

  it('throws when the safety-adjusted available output is exactly zero', () => {
    const context = textContext(12_288)

    expect(estimateContextTokens(context).tokens + 4097).toBe(16_385)
    expect(() => { assertUsefulContextCapacity(model(), context, 4097) }).toThrow(LlmError)
    expect(clampMaxTokensToContext(model(), context, 4097)).toBe(1)
  })

  it('rejects a one-token inference even when ample reserve remains', () => {
    const context = textContext(8000)

    expect(16_384 - estimateContextTokens(context).tokens - 4096).toBeGreaterThan(1)
    expect(() => { assertUsefulContextCapacity(model(), context, 1) }).toThrow(LlmError)
    expect(clampMaxTokensToContext(model(), context, 1)).toBe(1)
  })

  it('rejects the positive output floor when the context window is unknown', () => {
    const context = normalizeContext({ messages: [] })

    expect(() => { assertUsefulContextCapacity(model(0), context, 0) }).toThrow(LlmError)
    expect(clampMaxTokensToContext(model(0), context, 0)).toBe(1)
    expect(() => { assertUsefulContextCapacity(model(0), context, 2) }).not.toThrow()
    expect(clampMaxTokensToContext(model(0), context, 2)).toBe(2)
  })

  it('throws instead of starting a request whose estimated input and output do not fit', () => {
    const context = normalizeContext({
      messages: [{ role: 'user', content: 'u'.repeat(52_500), timestamp: 0 }],
    })

    expect(() => { assertUsefulContextCapacity(model(), context, 2048) }).toThrow(expect.objectContaining({
      code: CONTEXT_WINDOW_EXCEEDED_CODE,
      message: 'pi-ai context budget for model "vision-16k" has no useful output capacity: estimated 15000 input in a 16384-token window reduces requested 2048 output tokens to 1',
    }))
  })
})

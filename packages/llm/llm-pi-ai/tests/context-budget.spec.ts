import { describe, expect, it } from 'vitest'
import type { Model, Tool, TranscriptContext } from '@earendil-works/pi-ai'
import { clampMaxTokensToContext } from '@earendil-works/pi-ai/api/simple-options'
import { estimateContextTokens, estimateMessageTokens, estimateTextTokens } from '@earendil-works/pi-ai/utils/estimate'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'

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

describe('patched pi-ai context output budget', () => {
  it('reproduces the captured Vision request estimate without collapsing its requested output', () => {
    const context = capturedVisionContext()
    const system = context.messages[0]!
    const history = context.messages.slice(1)

    expect(estimateTextTokens('s'.repeat(5868))).toBe(1677)
    expect(estimateMessageTokens(system) - estimateTextTokens('s'.repeat(5868))).toBe(8758)
    expect(history.map(estimateMessageTokens)).toEqual([1379, 213, 287, 74])
    expect(estimateContextTokens(context).tokens).toBe(12_388)
    expect(clampMaxTokensToContext(model(), context, 2048)).toBe(2048)
  })

  it('keeps the requested output after a tool-call turn when the estimated request still fits', () => {
    const context = capturedVisionContext()
    context.messages.push(
      {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'call-1', name: 'inspect', arguments: {} }],
        api: 'openai-completions',
        provider: 'gateway',
        model: 'vision-16k',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'toolUse',
        timestamp: 0,
      },
      {
        role: 'toolResult',
        toolCallId: 'call-1',
        toolName: 'inspect',
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
        timestamp: 0,
      },
    )

    expect(estimateContextTokens(context).tokens).toBe(12_392)
    expect(clampMaxTokensToContext(model(), context, 2048)).toBe(2048)
  })

  it('retains the safety clamp when it leaves output room', () => {
    const context = textContext(12_000)

    expect(estimateContextTokens(context).tokens).toBe(12_000)
    expect(clampMaxTokensToContext(model(), context, 6000)).toBe(288)
  })

  it('keeps the requested output when its estimate exactly fills the context window', () => {
    const context = textContext(14_336)

    expect(estimateContextTokens(context).tokens + 2048).toBe(16_384)
    expect(clampMaxTokensToContext(model(), context, 2048)).toBe(2048)
  })

  it('throws when the safety-adjusted available output is exactly zero', () => {
    const context = textContext(12_288)

    expect(estimateContextTokens(context).tokens + 4097).toBe(16_385)
    expect(() => clampMaxTokensToContext(model(), context, 4097)).toThrow(RangeError)
  })

  it('retains the safety clamp at one available output token', () => {
    const context = textContext(12_287)

    expect(16_384 - estimateContextTokens(context).tokens - 4096).toBe(1)
    expect(clampMaxTokensToContext(model(), context, 4098)).toBe(1)
  })

  it('retains the positive output floor when the context window is unknown', () => {
    const context = normalizeContext({ messages: [] })

    expect(clampMaxTokensToContext(model(0), context, 0)).toBe(1)
  })

  it('throws instead of starting a request whose estimated input and output do not fit', () => {
    const context = normalizeContext({
      messages: [{ role: 'user', content: 'u'.repeat(52_500), timestamp: 0 }],
    })

    expect(() => clampMaxTokensToContext(model(), context, 2048)).toThrow(
      'Input exceeds the model\'s context window for "vision-16k": estimated 15000 input + 2048 output > 16384',
    )
  })
})

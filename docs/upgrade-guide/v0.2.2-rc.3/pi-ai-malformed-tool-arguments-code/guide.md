---
kind: upgrade-guide
description: "pi-ai invalid completed tool arguments now use MALFORMED_TOOL_ARGUMENTS instead of MALFORMED_RESPONSE."
---

# `MALFORMED_TOOL_ARGUMENTS` identifies invalid pi-ai tool arguments

English | [中文](guide.zh.md)

## Change

When pi-ai reports invalid completed tool-call arguments, `LlmFailure.code` is now `MALFORMED_TOOL_ARGUMENTS` instead of the broader `MALFORMED_RESPONSE`. Consumers that route this failure or configure it in `retryPolicy.retryableCodes` are affected. Other malformed provider responses continue to use `MALFORMED_RESPONSE`.

## Migration

1. Replace `MALFORMED_RESPONSE` with `MALFORMED_TOOL_ARGUMENTS` in handling that targets invalid completed tool arguments.
2. To retry this failure once without reducing the shared retry limit, add `MALFORMED_TOOL_ARGUMENTS` to the provider's `retryPolicy.retryableCodes` and set `retryPolicy.maxRetriesByCode.MALFORMED_TOOL_ARGUMENTS` to `1`.
3. Confirm that an invalid tool-call attempt records `MALFORMED_TOOL_ARGUMENTS`, dispatches no call from that response, and records at most one `llm/retry` in the same step.

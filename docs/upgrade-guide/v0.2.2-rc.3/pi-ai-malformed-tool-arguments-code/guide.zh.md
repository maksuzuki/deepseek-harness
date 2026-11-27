---
kind: upgrade-guide
description: "pi-ai 的无效已完成工具参数现在使用 MALFORMED_TOOL_ARGUMENTS，而不是 MALFORMED_RESPONSE。"
---

# `MALFORMED_TOOL_ARGUMENTS` 标识无效的 pi-ai 工具参数

[English](guide.md) | 中文

## 变更

当 pi-ai 报告无效的已完成工具调用参数时，`LlmFailure.code` 现在是 `MALFORMED_TOOL_ARGUMENTS`，而不是更宽泛的 `MALFORMED_RESPONSE`。按此失败进行路由或在 `retryPolicy.retryableCodes` 中配置它的消费方会受到影响。其他格式错误的提供方响应继续使用 `MALFORMED_RESPONSE`。

## 迁移

1. 在专门处理无效已完成工具参数的逻辑中，把 `MALFORMED_RESPONSE` 替换为 `MALFORMED_TOOL_ARGUMENTS`。
2. 如需在不降低共享重试上限的情况下重试此失败一次，请把 `MALFORMED_TOOL_ARGUMENTS` 加入提供方的 `retryPolicy.retryableCodes`，并把 `retryPolicy.maxRetriesByCode.MALFORMED_TOOL_ARGUMENTS` 设为 `1`。
3. 确认无效工具调用尝试记录 `MALFORMED_TOOL_ARGUMENTS`，不分派该响应中的任何调用，并在同一步骤中最多记录一次 `llm/retry`。

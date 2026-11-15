---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-15-openai-search-request

[English](2026-11-15-openai-search-request.md) | 中文

## 概述

增加持久化的 web/openai-search-llm-request 事件，记录发送前不含秘密的 OpenAI Responses API 搜索请求。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-15-openai-search-request
baseline: false
changes:
  - root: "event:web/openai-search-llm-request"
    previous: null
    after: "6121e83c5d0c1f553b76b8d7365d2e054f2686e51bf8bdcc47a86e113788a4a4"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

现有 V4 日志保持有效，且不会补造搜索请求历史。新日志增加一个必需事件类型，其 payload 包含固定的官方 endpoint 和请求 body，但不包含 authorization header 或 API key。旧版本遇到未知事件时会拒绝日志，而不会静默丢弃辅助请求记录。Session header 和所有既有事件 payload 均不变。

<a id="verification"></a>
## 验证

Provider、settings、redirect、proxy egress、真实 Loader composition、bundle 和 UI 的集中测试共 118 项通过，并达到逐文件 100% 覆盖率。Settings 测试验证一次实际搜索会追加精确且不含秘密的事件；无密钥 headless snapshot 通过 shipped profile 验证未配置 Provider 的路径。

<a id="dev-note"></a>
## 开发备注

无。

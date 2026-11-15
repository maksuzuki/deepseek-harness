---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-15-openai-search-request

[English](2026-11-15-openai-search-request.md) | 中文

## 概述

新增持久化的 web/openai-search-llm-request 事件，记录发送前不含密钥的 OpenAI Responses API 搜索请求。

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

现有 V4 日志仍然有效。新日志增加一个必需事件，其载荷包含固定端点和请求正文，但不包含授权标头或 API 密钥。旧版读取器会拒绝未知的必需事件，而不会静默丢弃请求记录。Session 标头和现有事件载荷保持不变。

<a id="verification"></a>
## 验证

提供方、设置、重定向、代理出口、Loader 组合及无密钥 headless 快照测试均已通过。Typecheck 已通过。已配置搜索的测试确认追加事件与实际发送的不含密钥的请求正文一致。

<a id="dev-note"></a>
## 开发备注

无。

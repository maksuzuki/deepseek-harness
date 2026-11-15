---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-15-boolean-thinking

[English](2026-11-15-boolean-thinking.md) | 中文

## 概述

为模型选择、请求头和可续接子代理描述符添加可选的布尔 Thinking。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-15-boolean-thinking
baseline: false
changes:
  - root: "event:model/selection"
    previous: "2026-09-11-initial"
    after: "1ed1b54c9049e5e4845efd2042d2b7d9a8631b102ec43c8e695a66318ce4fa15"
    decision: same-version
  - root: "event:request/header"
    previous: "2026-09-16-session-format-v4"
    after: "66cdcff3a95025f3f091ce68e64b5dbdb2756aa356b74983440fee82e3b65bf1"
    decision: same-version
  - root: "event:subagent/descriptor"
    previous: "2026-09-11-initial"
    after: "15f0856610bf3da5ed7769dd0c53700e8e5f50a4eb8e9347056788ae0fe48026"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

旧版 V4 记录仍可读取，因为字段缺失表示没有明确的布尔选择。新读取器保留明确的 false，并通过 adapterDefaults.thinking 区分适配器默认值。新版子代理读取器同时接受描述符版本 3 和 4；仅在需要为冷恢复保存明确的 Thinking 时，写入器才输出版本 4，否则继续输出版本 3。旧读取器可能忽略模型选择中的 Thinking，但会拒绝含有新默认值标记的请求头，也无法恢复版本 4 的描述符。旧写入器在重写选择时无法保留布尔值；不同版本的写入器不能共用一个活动 Session。

<a id="verification"></a>
## 验证

针对 Session、模型选择、headless 恢复、子代理描述符和 pi-ai 适配器的测试已通过；无密钥 OpenAI Completions 模拟服务器观测到明确的 true 和默认的 false。未修改现有 Session 文件。

<a id="dev-note"></a>
## 开发备注

无。

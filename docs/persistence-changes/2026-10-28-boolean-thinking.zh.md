---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-28-boolean-thinking

[English](2026-10-28-boolean-thinking.md) | 中文

## 概述

在模型选择与请求头中添加可选的 boolean Thinking 选择和适配器默认值标记。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-28-boolean-thinking
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
```

<a id="compatibility"></a>
## 兼容性

既有记录对新读取方仍然有效，因为所有新增字段均为可选，字段缺失表示不支持或未选择。旧读取方可以忽略模型选择事件中附加的 Thinking 值，但会在执行前拒绝适配器默认值标记中含 `thinking` 的新请求头。旧写入方重写选择时也无法保留 boolean Thinking。不同版本的写入方因此不得共享同一个活动 Session。

<a id="verification"></a>
## 验证

型检查 5 个 gate 全部通过；聚焦 Vitest 614 项全部通过，实际 dsh web 进程 smoke 以 Thinking false、true 及进程重启后恢复的 true 通过，并在每次请求中保留 31 个工具。

<a id="dev-note"></a>
## 开发备注

无。

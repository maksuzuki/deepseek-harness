---
kind: upgrade-guide
description: "自动压缩无法达到配置阈值时，现在会拒绝压力状态，而不是在超过该阈值时继续发送模型请求。"
---

# 自动压缩强制执行压力阈值

[English](guide.md) | 中文

## 变更

以前，当没有安全的历史记录范围可以把测得的上下文降到 `thresholdTokens` 以下时，自动压力压缩仍允许发送下一次模型请求。现在，它会以上下文窗口错误结束当前轮次。没有匹配的 provider usage 时，测量总量可能使用启发式 baseline。固定提示词、工具定义、保留尾部、不可分割历史记录或这些内容的组合已经占满配置压力预算的 profile 会受到影响。

## 迁移

1. 调整受影响 profile 的压缩策略、固定提示词、工具集合、保留历史、预留输出大小或模型上下文容量，直到诊断中的 `totalTokensBefore` 可以在压缩后降到 `thresholdTokens` 以下。
2. 重新发送请求，并确认压缩报告的 `totalTokensAfter` 低于 `thresholdTokens`，然后再启动下一次普通模型请求。

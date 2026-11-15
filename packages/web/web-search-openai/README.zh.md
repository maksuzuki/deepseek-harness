---
description: "用于 ctx.web 的 OpenAI Responses API 网页搜索提供方：配置、凭据、结果映射、费用与失败行为。"
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-openai

[English](README.md) | 中文

## 概述

`dsh-web-search-openai` 在 `ctx.web` 中注册 `openai-web-search`，并通过 OpenAI Responses API 托管的 `web_search` 工具执行每次搜索。它复用 Models 页面存储的 `OPENAI_API_KEY` 凭据，只返回经确认且带 URL 的来源，并继续使用现有 HTTP 抓取提供方读取页面。OpenAI 官方端点固定不变，因此配置无法把 API Key 或查询转发到其他来源。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用此包

`dsh-base` 会挂载此提供方，但不会默认选中它。在 Web 应用中打开 **Plugins > Built-in plugin settings > Web search and fetch**，在 Search 下选择 **OpenAI web search**；如果模型需要继续读取返回的来源，可在 Fetch 下保留 **本机直接获取**。对话模型仍可使用 Strata 或任何其他已配置模型路由；只有 `web_search` 工具调用使用 OpenAI。

在 Models 页面把 OpenAI Key 存储到 `OPENAI_API_KEY`，或在启动 DSH 前导出该变量。每次搜索都会重新解析 Key，Key 不会返回给 Client；缺少 Key 时，`dsh-tool-web` 会通过现有 readiness 检查隐藏 `web_search`。选择提供方本身不会产生付费请求；只有模型或用户调用 `web_search` 才会发起请求。

### 配置

```yaml
- id: web-search-openai
  name: '@deepseek-ai/dsh-web-search-openai'
  config:
    apiKeyEnv: OPENAI_API_KEY
    model: gpt-5.4-mini
    searchContextSize: low
    maxOutputTokens: 1024
    maxToolCalls: 1
    country: JP
    timeoutMs: 60000
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `apiKeyEnv` | `OPENAI_API_KEY` | 每次搜索都通过 `ctx.credentials` 解析的凭据引用；未挂载凭据服务时从启动环境读取 |
| `model` | `gpt-5.4-mini` | 辅助 Responses API 模型 |
| `searchContextSize` | `low` | 托管搜索上下文大小：`low`、`medium` 或 `high` |
| `maxOutputTokens` | `1024` | 输出与推理 token 上限；必须是至少为 `16` 的整数 |
| `maxToolCalls` | `1` | 内置工具调用的正整数上限；`tool_choice: required` 仍会强制搜索 |
| `country` | 省略 | 用户明确提供的 ISO 3166-1 alpha-2 国家代码，例如 `JP`；不会从主机或用户推断位置 |
| `timeoutMs` | `60000` | 请求与响应的正整数超时毫秒数 |

端点始终为 `https://api.openai.com/v1/responses`。这保证配置无法重定向 bearer key 或搜索查询，但有意不支持 OpenAI 兼容代理。

### 结果与失败

请求设置 `tool_choice: "required"`，包含 `web_search_call.action.sources`，通过 `store: false` 禁用存储，并默认最多调用一次内置工具。提供方只接受状态为 completed、且含有 completed `web_search_call` 搜索 action 的响应。它组合 action source URL 与 `url_citation` 标题，丢弃缺失、格式错误及非 HTTP(S) URL，按规范化 URL 去重，并省略生成的回答文本与摘录。共享 web 服务在映射后应用 `maxResults`。

HTTP 失败、余额或支出限制、速率限制、错误 JSON、未完成响应、超时及凭据读取失败都会产生 `WebError`。调用方取消对应 `WEB_ABORTED`。请求使用 `redirect: error`，不会重试，也不会回退到其他搜索提供方。

### 费用与真实 API 验证

OpenAI 对托管网页搜索按工具调用、搜索内容 token 与模型 token 计费。[OpenAI 定价页面](https://developers.openai.com/api/docs/pricing)是权威来源；本文发布时，标准网页搜索列出的价格为每 1,000 次调用 10 美元，另按所选模型费率收取搜索内容 token 费用。`maxToolCalls` 限制单个响应中的工具调用次数，`maxOutputTokens`、`searchContextSize` 与所选模型则影响 token 使用量和价格。

真实 API 探针仅在同时存在 `OPENAI_API_KEY` 且 `DSH_OPENAI_WEB_SEARCH_E2E=1` 明确记录付费测试许可时运行。普通单元测试与 Loader 组合测试是不计费的替代验证，不能验证实时模型可用性、计费、速率限制或当前生产响应字段。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`src/index.ts` 负责 Cordis Config、逐操作凭据解析、readiness 与注册。`src/provider.ts` 负责固定来源请求、取消和超时生命周期、wire 校验、结构化响应映射，以及不含秘密的 Session 请求事件。

每次搜索会捕获一次实时设置、解析 Key、在有发起 Session 时追加 `web/openai-search-llm-request`，然后只分发一次。该事件记录端点与 JSON body，但不记录 header 或 Key；现有 tool-call 事件已经记录模型提供的查询。

-----

<a id="further-exploration"></a>
## 进一步探索

- [Web 服务](../web/README.zh.md)——提供方选择、readiness、取消与结果限制。
- [Web 工具](../tool-web/README.zh.md)——面向模型的 `web_search` 与 `web_fetch` 行为。
- [OpenAI 网页搜索指南](https://developers.openai.com/api/docs/guides/tools-web-search)——托管工具请求与引用字段。

-----

<a id="model-experience"></a>
## 模型体验

### 辅助 OpenAI 搜索请求

#### 模型看到的内容

辅助 OpenAI 模型把 `web_search` 查询作为完整输入，并接收要求强制调用的托管搜索工具、配置的搜索上下文大小及可选国家；不会收到对话历史或工作区文件。

#### Token 影响

一次辅助 Responses API 调用会在配置限制内消耗输入、搜索内容、推理与输出 token。托管工具最多运行 `maxToolCalls` 次。

#### KV Cache 影响

该请求独立执行且不含对话前缀，因此不会创建可复用的对话 KV-cache 前缀。

### 间接的对话工具结果

#### 模型看到的内容

`dsh-tool-web` 呈现受限的来源 URL 与可用标题。OpenAI 生成的回答正文不会作为搜索证据返回。

#### Token 影响

渲染后的来源列表会在下一模型步骤中消耗对话输入 token；`maxResults` 限制条目数量。

#### KV Cache 影响

不会直接改变前缀；普通工具结果会进入对话历史。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **官方端点固定**——这会阻止通过配置转发凭据，但不支持 OpenAI 兼容代理和私有网关。
- **来源不含经验证的摘录**——Responses API 来源列表提供 URL，引用提供标题；生成的回答文本不会被改作 snippet。
- **未提交实时响应 fixture**——实现此包时没有运行付费真实 API 探针，因此测试使用符合官方 schema 的合成响应，实时 API 兼容性仍未验证。
- **搜索使用 OpenAI，抓取不使用**——使用现有 HTTP 或 DeepSeek 抓取提供方读取选中的来源。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

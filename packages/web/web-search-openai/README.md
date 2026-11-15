---
description: "OpenAI Responses API web search provider for ctx.web: configuration, credentials, result mapping, cost, and failure behavior."
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-openai

English | [中文](README.zh.md)

## Summary

`dsh-web-search-openai` registers `openai-web-search` in `ctx.web` and runs each search through the OpenAI Responses API hosted `web_search` tool. It reuses the `OPENAI_API_KEY` credential that the Models page stores, returns only confirmed URL-bearing sources, and leaves page retrieval to the existing HTTP fetch provider. The official OpenAI endpoint is fixed so configuration cannot forward the API key or query to another origin.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

The `dsh-base` bundle mounts this provider without selecting it. In the Web application, open **Plugins > Built-in plugin settings > Web search and fetch**, choose **OpenAI web search** under Search, and keep **Direct fetch** under Fetch when the model should follow a returned source. The conversation model can remain Strata or any other configured model route; only the `web_search` tool call uses OpenAI.

Store an OpenAI key from the Models page under `OPENAI_API_KEY`, or export that variable before launching DSH. The key is resolved per search, is never returned to the Client, and a missing key makes `dsh-tool-web` withhold `web_search` through the existing readiness check. Selecting the provider does not start a paid request; a model or user must invoke `web_search`.

### Configuration

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

| Field | Default | Meaning |
|---|---|---|
| `apiKeyEnv` | `OPENAI_API_KEY` | Credential reference resolved for every search through `ctx.credentials`, or the launch environment when the credential service is absent |
| `model` | `gpt-5.4-mini` | Auxiliary Responses API model |
| `searchContextSize` | `low` | Hosted search context size: `low`, `medium`, or `high` |
| `maxOutputTokens` | `1024` | Output and reasoning token ceiling; integer at least `16` |
| `maxToolCalls` | `1` | Positive-integer ceiling across built-in tool calls; `tool_choice: required` still forces search |
| `country` | omitted | User-supplied ISO 3166-1 alpha-2 country, such as `JP`; no location is inferred from the host or user |
| `timeoutMs` | `60000` | Positive-integer request and response timeout |

The endpoint is always `https://api.openai.com/v1/responses`. This guarantees that configuration cannot redirect the bearer key or search query, but it intentionally prevents use with an OpenAI-compatible proxy.

### Results and failures

The request sets `tool_choice: "required"`, includes `web_search_call.action.sources`, disables storage with `store: false`, and defaults to one built-in tool call. The provider accepts only a completed response with a completed `web_search_call` whose action is `search`. It returns valid `url_citation` URLs in citation order, then appends action-only source URLs in source order, preserves available citation titles, drops missing, malformed, and non-HTTP(S) URLs, deduplicates normalized URLs, and omits generated answer text and excerpts. The shared web service applies `maxResults` after mapping.

HTTP failures, credit or spend limits, rate limits, malformed JSON, incomplete responses, timeouts, and credential-read failures produce `WebError`. Caller cancellation is `WEB_ABORTED`. Requests use `redirect: error`, never retry, and never fall back to another search provider.

### Cost and real-API validation

OpenAI bills hosted web search per tool call plus search-content and model tokens. The [OpenAI pricing page](https://developers.openai.com/api/docs/pricing) is the authority; at publication time, standard web search is listed as USD 10 per 1,000 calls plus search-content tokens at the selected model's rates. `maxToolCalls` bounds tool calls in one response, while `maxOutputTokens`, `searchContextSize`, and the selected model affect token use and price.

The real-API probe runs only when both `OPENAI_API_KEY` is available and `DSH_OPENAI_WEB_SEARCH_E2E=1` explicitly records paid-test approval. Ordinary unit and Loader-composition tests are non-billable substitutes and do not validate live model availability, billing, rate limits, or the current production response fields.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`src/index.ts` owns Cordis Config, per-operation credential resolution, readiness, and registration. `src/provider.ts` owns the fixed-origin request, cancellation and timeout lifecycle, wire validation, structured response mapping, and secret-free Session request event.

Each search captures the live settings once, resolves the key, appends `web/openai-search-llm-request` under an initiating Session, and dispatches exactly once. The event records the endpoint and JSON body but never headers or the key; the existing tool-call event already records the query supplied by the model.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Web service](../web/README.md) — provider selection, readiness, cancellation, and result limits.
- [Web tool](../tool-web/README.md) — model-facing `web_search` and `web_fetch` behavior.
- [OpenAI web search guide](https://developers.openai.com/api/docs/guides/tools-web-search) — hosted tool request and citation fields.

-----

<a id="model-experience"></a>
## Model Experience

### Auxiliary OpenAI search request

#### What the model sees

The auxiliary OpenAI model receives the `web_search` query as its complete input, the hosted search tool with a required tool choice, the configured search context size and optional country, and no conversation history or workspace files.

#### Token effect

One auxiliary Responses API call consumes input, search-content, reasoning, and output tokens within the configured limits. The hosted tool can run at most `maxToolCalls` times.

#### KV Cache effect

The request is independent and carries no conversation prefix, so it creates no reusable conversation KV-cache prefix.

### Conversation tool result indirectly

#### What the model sees

`dsh-tool-web` renders the bounded source URLs and available titles. OpenAI-generated answer prose is not returned as search evidence.

#### Token effect

The rendered source list consumes conversation input tokens on the next model step; `maxResults` bounds the number of entries.

#### KV Cache effect

No direct prefix change; the normal tool result enters conversation history.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The official endpoint is fixed** — this prevents credential forwarding through configuration, but excludes OpenAI-compatible proxies and private gateways.
- **Sources expose no verified excerpt** — the Responses API source list supplies URLs and citations supply titles; generated answer text is intentionally not repurposed as a snippet.
- **No live response fixture is committed** — the paid real-API probe was not run while implementing this package, so tests use synthetic official-schema responses and live API compatibility remains unverified.
- **Search is OpenAI-only, fetch is not** — use the existing HTTP or DeepSeek fetch provider to retrieve a selected source.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

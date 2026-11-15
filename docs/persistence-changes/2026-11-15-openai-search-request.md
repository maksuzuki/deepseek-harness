---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-15-openai-search-request

English | [中文](2026-11-15-openai-search-request.zh.md)

## Summary

Adds the durable web/openai-search-llm-request event for the secret-free OpenAI Responses API search request recorded before dispatch.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Existing V4 logs remain valid. New logs add a required event whose payload contains the fixed endpoint and request body but no authorization header or API key. Older readers reject an unknown required event instead of silently dropping the request record. The Session header and existing event payloads are unchanged.

<a id="verification"></a>
## Verification

The provider, settings, redirect, proxy-egress, Loader-composition, and keyless headless snapshot tests passed. Typecheck passed. The configured search test checks that the appended event matches the dispatched secret-free request body.

<a id="dev-note"></a>
## Dev Note

None.

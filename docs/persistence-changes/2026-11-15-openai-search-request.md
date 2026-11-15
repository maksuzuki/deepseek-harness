---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-15-openai-search-request

English | [中文](2026-11-15-openai-search-request.zh.md)

## Summary

Adds the durable web/openai-search-llm-request event for the secret-free OpenAI Responses API search request recorded immediately before dispatch.

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

Existing V4 logs remain valid and receive no fabricated search-request history. New logs add a required event kind whose payload contains the fixed official endpoint and request body, but no authorization header or API key. Older builds reject logs containing the unknown event instead of silently dropping the auxiliary request record. The Session header and all existing event payloads are unchanged.

<a id="verification"></a>
## Verification

The focused provider, settings, redirect, proxy-egress, real Loader-composition, bundle, and UI suites pass 118 tests with per-file 100% coverage. The settings test verifies that a live search appends the exact secret-free event, and the keyless headless snapshot verifies the unconfigured provider path through the shipped profile.

<a id="dev-note"></a>
## Dev Note

None.

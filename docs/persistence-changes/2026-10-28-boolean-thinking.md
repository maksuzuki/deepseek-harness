---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-28-boolean-thinking

English | [中文](2026-10-28-boolean-thinking.zh.md)

## Summary

Adds optional boolean Thinking selections and adapter-default markers to model selection and request headers.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Existing records remain valid for new readers because every new field is optional, and absence means unsupported or unselected. An older reader can ignore an additive Thinking value on a model-selection event, but it rejects a new request header whose adapter-default markers contain `thinking` before executing it. Older writers also cannot preserve a boolean Thinking choice when rewriting a selection. Mixed-version writers must therefore not share one live Session.

<a id="verification"></a>
## Verification

Build passed all 10 gates; focused pi-ai and Thinking suites passed, and the real dsh web process smoke passed with Thinking false, true, and restored true after process restart, retaining 32 tools on every request.

<a id="dev-note"></a>
## Dev Note

None.

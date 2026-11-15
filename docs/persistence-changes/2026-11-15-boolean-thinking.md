---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-15-boolean-thinking

English | [中文](2026-11-15-boolean-thinking.zh.md)

## Summary

Adds optional boolean Thinking to model selections, request headers, and continuable subagent descriptors.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Existing V4 records remain valid because absence means no explicit boolean selection. New readers retain explicit false and distinguish an adapter default through adapterDefaults.thinking. New subagent readers accept descriptor versions 3 and 4; the writer emits version 4 only when explicit Thinking must survive cold resume, and otherwise retains version 3. Older readers may ignore a Thinking selection, but reject a request header with the new adapter-default marker and cannot resume descriptor version 4. Older writers cannot preserve a boolean selection when rewriting it; mixed-version writers must not share one live Session.

<a id="verification"></a>
## Verification

Focused Session, model-selection, headless-resume, subagent descriptor and pi-ai adapter tests passed; the keyless OpenAI Completions mock server observed explicit true and default false. Existing Session files were not modified.

<a id="dev-note"></a>
## Dev Note

None.

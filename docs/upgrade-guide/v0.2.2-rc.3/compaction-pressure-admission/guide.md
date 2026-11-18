---
kind: upgrade-guide
description: "Automatic compaction now rejects a pressure state that cannot reach its configured threshold instead of sending another model request above that threshold."
---

# Automatic compaction enforces the pressure threshold

English | [中文](guide.zh.md)

## Change

Automatic pressure compaction previously allowed the next model request when no safe history range could reduce the measured context below `thresholdTokens`. It now ends the turn with a context-window error. The measured total can use a heuristic baseline when no matching provider usage is available. This affects profiles whose fixed prompt, tool definitions, retained tail, or indivisible history already consume the configured pressure budget.

## Migration

1. Adjust the affected profile's compaction policy, fixed prompt, tool set, retained history, reserved completion size, or model context capacity until the diagnostic `totalTokensBefore` can fall below `thresholdTokens` after compaction.
2. Repeat the request and confirm that compaction reports `totalTokensAfter` below `thresholdTokens` before the next ordinary model request starts.

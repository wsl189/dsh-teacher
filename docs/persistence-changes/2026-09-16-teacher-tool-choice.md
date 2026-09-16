---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-16-teacher-tool-choice

English | [中文](2026-09-16-teacher-tool-choice.zh.md)

## Summary

Record the optional toolChoice request setting retained by the teacher distribution.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-09-16-teacher-tool-choice
baseline: false
changes:
  - root: "event:request/header"
    previous: "2026-09-11-initial"
    after: "d1c3f0c4a0dd526c4558e19f5b75d61cd30a2f0d2169de63d26ad698a2cac1dc"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

The request header accepts an omitted toolChoice or the existing auto, required, and none values. This optional field does not change the structural session format; readers preserve it with the model request configuration.

<a id="verification"></a>
## Verification

The generated persistence schema classifies the addition as same-version compatible. Focused LLM and model-configuration tests cover retained request routing and tool selection.

<a id="dev-note"></a>
## Dev Note

None.

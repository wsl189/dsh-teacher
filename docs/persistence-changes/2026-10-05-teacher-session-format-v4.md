---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-05-teacher-session-format-v4

English | [中文](2026-10-05-teacher-session-format-v4.zh.md)

## Summary

Adopts upstream dsh-v0.2.1-alpha.1 in DSH Teacher and advances the teacher writer from Session V3 to V4. The transition includes tool-role results, producer-owned sources, developer records, and late user-question replies, while retaining the optional teacher tool-choice field and OCR/model-check message attribution.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-05-teacher-session-format-v4
baseline: false
changes:
  - root: "SessionHeader"
    previous: "2026-09-11-initial"
    after: "1a3440e3577382704d42a6263aa463504eb74c566734a55e9503a63efcd02445"
    decision: version-bump
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-14-image-offload"
    after: "f3e1ec4605d357c0bded966d0abf062168778b84f136be6a6fcda720d01f7476"
    decision: version-bump
  - root: "event:assistant/attempt"
    previous: "2026-09-14-image-offload"
    after: "15d5dfdd822aa35e115afd74a8982825a493880457774e6850bc1520b50875e4"
    decision: version-bump
  - root: "event:assistant/message"
    previous: "2026-09-14-image-offload"
    after: "1033093edd0db80ff410e00830b523405e00bb0c7684948e531ff65095799625"
    decision: version-bump
  - root: "event:compaction/summary"
    previous: "2026-09-14-image-offload"
    after: "e2f9a41e0989f54ed8cee80f8db2bcf9d60a5c810dc9d45b83fa050b9dce7602"
    decision: version-bump
  - root: "event:developer/message"
    previous: null
    after: "7c3f65c5ef7e39e3ac29b8c9f46d7c18b5a6401f425839c0775fefc0bfa1a4e4"
    decision: version-bump
  - root: "event:request/header"
    previous: "2026-09-16-teacher-tool-choice"
    after: "a47f524cda2e4d58d434e2cc5db7b6b27a94d49907a487542f4616d79324856f"
    decision: version-bump
  - root: "event:session/title-llm-request"
    previous: "2026-09-14-image-offload"
    after: "d43a0a8f23e67271d1785ce68b477291d4943385ca62543d3c7cd0a629150d9a"
    decision: version-bump
  - root: "event:system/message"
    previous: "2026-09-14-image-offload"
    after: "69081694be231d56fd9580ba14645fd5e35373202605d5c5c841a9435b5fa3b1"
    decision: version-bump
  - root: "event:team/message/queued"
    previous: "2026-09-14-image-offload"
    after: "21fb6a90d5068f6a0003b7ab316ed2f56342477146a65c00db0f13c4d8df667d"
    decision: version-bump
  - root: "event:tool/ptc-dispatch"
    previous: "2026-09-14-image-offload"
    after: "100f6dca1468538239522cde3533e5bd721d0f1a7b50bea8b0eb533ea6c96163"
    decision: version-bump
  - root: "event:tool/result"
    previous: "2026-09-14-image-offload"
    after: "7c9f44e90a0058f4cc532ae20dad0c10afa6eba22e70a6c79fc79490bad64397"
    decision: version-bump
  - root: "event:turn/end"
    previous: "2026-09-14-image-offload"
    after: "0f8512903d94f57a4748fa1a2092e64342856796684e6b8343db685b192745ce"
    decision: version-bump
  - root: "event:user/message"
    previous: "2026-09-14-image-offload"
    after: "8881bb31dd0435a6c25d93d4fb3ff6832490c6188818658ed007d2b141a7c03e"
    decision: version-bump
```

<a id="compatibility"></a>
## Compatibility

This is the teacher fork’s first V4 adoption. Its predecessor history includes the released 2026-09-16-teacher-tool-choice record, so it cannot reuse the upstream V4 checkpoint that descends from a different request header. All existing teacher acknowledgements and historical release schemas remain unchanged. The shared V3-to-V4 reader performs the upstream migration; V0–V3 originals remain readable and their predecessor files are preserved. Unknown producer metadata follows the upstream attribution-preservation policy. OCR notices and model checks use typed producer sources in newly written V4 records; toolChoice remains optional and provider-neutral.

<a id="verification"></a>
## Verification

The combined Host regression suite passed 809 tests, including Settings, teacher workbench, session-controller model checks, DeepSeek serialization and reflection generation. The model settings browser scenario passed all 19 tests; the uploaded-document scenario verified that exactly one OCR message carries extracted text while the visible conversation omits it. The ordinary persistence verifier checks the generated inventories and the fork checkpoint against this declaration.

<a id="dev-note"></a>
## Dev Note

None.

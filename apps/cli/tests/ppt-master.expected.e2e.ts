import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const binScript = fileURLToPath(new URL('./fixtures/dsh-badge/snapshot.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/ppt-master/cordis.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const assetsPath = fileURLToPath(new URL('../../../packages/skill/skill-ppt-master/assets/ppt-master/', import.meta.url))

describe('PPT Master assembled snapshot', () => {
  it('advertises and loads the complete built-in presentation skill', async () => {
    const result = await runLoaderSmoke({
      label: 'PPT Master skill snapshot',
      tempDirPrefix: 'headless-snapshot-ppt-master-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath, 'ppt-master'],
      tsconfigPath,
    })
    const snapshot = JSON.parse(
      result.stdout.replaceAll(assetsPath, '{{pptMasterAssetsPath}}'),
    ) as unknown

    expect(result.stderr).toBe('')
    expect(snapshot).toMatchInlineSnapshot(`
      {
        "catalog": [
          {
            "text": "<system-reminder>
      A skill is a reusable set of task-specific instructions. The following skills are available in this session:

      <available_skills>
      - \`ppt-master\`: AI-driven presentation workflow for generating editable PPTX decks and slides, reconstructing page visuals, creating reusable Brand/Style/Layout/Deck workspaces, filling native PPTX templates, and enhancing finished PPTX files. Use when the user asks to create, generate, reconstruct, regenerate, beautify, redesign, template, fill, or enhance a presentation, PPT, PPTX, slide deck, or courseware — including adding narration or animation to one — requests a presentation-authored narrated/self-ru...
      </available_skills>

      If the user names a skill, or the task clearly matches a skill's description, call the \`skill\` tool with the exact skill name before taking task actions. Load all applicable skills, then follow their full instructions. This catalog contains summaries only; do not infer or follow a skill's instructions until it has been loaded.
      A user may also invoke a skill directly; its <skill_content> block then appears in this conversation. Follow it, and do not call the \`skill\` tool again for that skill.
      </system-reminder>",
            "type": "text",
          },
        ],
        "result": {
          "content": [
            {
              "text": "<skill_content name="ppt-master">
      <skill_resources>
      Base directory for this skill: {{pptMasterAssetsPath}}
      Resolve relative paths mentioned by this skill against the base directory before using them. Load referenced resources only as needed.
      </skill_resources>

      <skill_instructions>

      # PPT Master Skill

      PPT Master is a routed presentation workflow. This entry owns global execution discipline and route selection only; each selected route owns its procedure.

      ## Mandatory Load Order

      **Hard rule — paths before commands**: Retain the host-provided absolute
      directory containing this file as \`SKILL_DIR\`. Per tool call, expand
      \`\${SKILL_DIR}\` and replace any \`skills/ppt-master/\` prefix with it. Never \`cd\`,
      use CWD, or assume a repo checkout. If unavailable, ask; never search or guess.

      1. Read this file.
      2. Run \`python3 "\${SKILL_DIR}/scripts/attribution_guard.py"\`. Any non-zero result
         stops the Skill immediately; do not inspect, repair, or bypass the integrity
         gate.
      3. Read [\`workflows/routing.md\`](workflows/routing.md) through the concrete
         absolute path \`\${SKILL_DIR}/workflows/routing.md\`.
      4. Select exactly one top-level route and its active profile from the routing
         authority.
      5. Read only the resulting runtime authority and its explicitly triggered
         supporting documents.

      | Selected route / profile | Runtime authority |
      |---|---|
      | Generate PPTX — Image to PPTX | [\`workflows/profiles/image-to-pptx.md\`](workflows/profiles/image-to-pptx.md); Codex-supported, always Quick |
      | Generate PPTX — Beautify | [\`workflows/profiles/beautify-pptx.md\`](workflows/profiles/beautify-pptx.md); explicit Quick intent selects Quick, otherwise Default |
      | Generate PPTX — ordinary Default | [\`workflows/generate-pptx.md\`](workflows/generate-pptx.md) |
      | Generate PPTX — ordinary explicit Quick | [\`workflows/profiles/quick-generate.md\`](workflows/profiles/quick-generate.md) |
      | Create Template | [\`workflows/create-template.md\`](workflows/create-template.md) |
      | Edit Native PPTX | [\`workflows/edit-native-pptx.md\`](workflows/edit-native-pptx.md) |

      **Hard rule — selected authority only**: Do not load another top-level route's
      procedure after routing. Image to PPTX and Beautify are mutually exclusive;
      Image to PPTX activates Quick, while Beautify selects from explicit Quick
      intent. Never load both runtimes. Supporting documents refine one route; they
      never compete with it.

      ---

      ## Authored Expression Range

      **Reference — not a constraint**: what a generated page can carry. Text — inline
      emphasis runs, lead-in, kicker, pull quote, hero number, takeaway line. Geometry
      — 187 Office presets, Boolean merge, connectors, freeform, page-field and
      outline-carrier composition. Image — full-bleed field, editorial crop, shaped
      picture, registered layers, scrim and spotlight, cross-page continuity. Paint —
      gradients, channel alpha, native shadow and glow, halftone, faceted form.
      Recurrence — one cross-page motif varied by page role. Each form's syntax lives
      in the selected runtime authority's construction references.

      ---

      ## Phase Frame

      Every route is one Plan → Do·Check·Act cycle: Plan ends when every authoring
      input exists as a file or retained decision; Do authors pages, Check runs the
      route's gates, Act repairs at the owning layer (discipline 7), and the cycle
      ends at export. Step numbers stay as written.

      | Phase | Default | Quick | Edit Native | Create Template |
      |---|---|---|---|---|
      | **Plan** | Steps 1–5 | §2 | §1–4 | Steps 1–3 |
      | **Do·Check·Act** | Steps 6–7 | §3–4 | §5–7 | Steps 4–8 |

      ## Global Execution Discipline

      1. **Serial execution** — Follow the selected authority's steps in order. A completed non-blocking step may continue directly to the next eligible step.
      2. **Blocking means stop** — At every \`⛔ BLOCKING\` gate, wait for explicit user confirmation. Do not decide on the user's behalf.
      3. **No cross-phase bundling** — Do not combine work across an unclosed gate. Once the route's final user gate closes, later non-blocking steps may continue automatically.
      4. **Gate before entry** — Verify every listed prerequisite before entering a step.
      5. **No speculative execution** — Do not prepare later-phase artifacts before their owning step.
      6. **Deterministic routing** — Do not add a route-choice question when [\`routing.md\`](workflows/routing.md) resolves the request. If a route prerequisite is missing, state it and stop that route.
      7. **Act at the owning layer** — On failure, repair at the shallowest layer that owns the fault: the page for a page-local issue, the Plan artifact for a roster/spec/resource fault, the owning source artifact for a tool failure; then resume from the route's declared pointer. Do not silently downgrade a required artifact.

      ## Global Communication Rules

      - Match the user's language and source language unless the user explicitly overrides it.
      - Localize user-facing option labels and explanations. Keep exact enum IDs or field names when needed for precision.
      - Keep \`design_spec.md\` section headings and field names in the template's original English; content values may use the user's language.
      - Before switching roles, read the corresponding role reference and output:

      \`\`\`markdown
      ## [Role Switch: <Role Name>]
      📖 Reading role definition: references/<filename>.md
      📋 Current task: <brief description>
      \`\`\`

      ---

      ## Repository Compatibility

      - This package is a workflow/skill, not a generic application scaffold. Do not create \`.worktrees/\`, \`tests/\`, branch workflows, or generic engineering structure by default.
      - Keep required workflow, reference, script, and template documentation inside this Skill directory.
      - Repository-level documents may point into the package; package runtime files must not depend on repository-level instructions.
      - On Windows, if a documented \`python3 ...\` command is unavailable, rerun the same command with \`python\`.
      - Sponsor information is optional reference material. Read the matching [\`SPONSORS.md\`](SPONSORS.md) or [\`SPONSORS_CN.md\`](SPONSORS_CN.md) only when the user explicitly requests a model, AI image model, API/provider, or hosted-service recommendation. Never surface sponsor or model recommendations proactively during normal generation, troubleshooting, or quality review.

      </skill_instructions>
      </skill_content>",
              "type": "text",
            },
          ],
          "isError": false,
          "value": {
            "content": "
      # PPT Master Skill

      PPT Master is a routed presentation workflow. This entry owns global execution discipline and route selection only; each selected route owns its procedure.

      ## Mandatory Load Order

      **Hard rule — paths before commands**: Retain the host-provided absolute
      directory containing this file as \`SKILL_DIR\`. Per tool call, expand
      \`\${SKILL_DIR}\` and replace any \`skills/ppt-master/\` prefix with it. Never \`cd\`,
      use CWD, or assume a repo checkout. If unavailable, ask; never search or guess.

      1. Read this file.
      2. Run \`python3 "\${SKILL_DIR}/scripts/attribution_guard.py"\`. Any non-zero result
         stops the Skill immediately; do not inspect, repair, or bypass the integrity
         gate.
      3. Read [\`workflows/routing.md\`](workflows/routing.md) through the concrete
         absolute path \`\${SKILL_DIR}/workflows/routing.md\`.
      4. Select exactly one top-level route and its active profile from the routing
         authority.
      5. Read only the resulting runtime authority and its explicitly triggered
         supporting documents.

      | Selected route / profile | Runtime authority |
      |---|---|
      | Generate PPTX — Image to PPTX | [\`workflows/profiles/image-to-pptx.md\`](workflows/profiles/image-to-pptx.md); Codex-supported, always Quick |
      | Generate PPTX — Beautify | [\`workflows/profiles/beautify-pptx.md\`](workflows/profiles/beautify-pptx.md); explicit Quick intent selects Quick, otherwise Default |
      | Generate PPTX — ordinary Default | [\`workflows/generate-pptx.md\`](workflows/generate-pptx.md) |
      | Generate PPTX — ordinary explicit Quick | [\`workflows/profiles/quick-generate.md\`](workflows/profiles/quick-generate.md) |
      | Create Template | [\`workflows/create-template.md\`](workflows/create-template.md) |
      | Edit Native PPTX | [\`workflows/edit-native-pptx.md\`](workflows/edit-native-pptx.md) |

      **Hard rule — selected authority only**: Do not load another top-level route's
      procedure after routing. Image to PPTX and Beautify are mutually exclusive;
      Image to PPTX activates Quick, while Beautify selects from explicit Quick
      intent. Never load both runtimes. Supporting documents refine one route; they
      never compete with it.

      ---

      ## Authored Expression Range

      **Reference — not a constraint**: what a generated page can carry. Text — inline
      emphasis runs, lead-in, kicker, pull quote, hero number, takeaway line. Geometry
      — 187 Office presets, Boolean merge, connectors, freeform, page-field and
      outline-carrier composition. Image — full-bleed field, editorial crop, shaped
      picture, registered layers, scrim and spotlight, cross-page continuity. Paint —
      gradients, channel alpha, native shadow and glow, halftone, faceted form.
      Recurrence — one cross-page motif varied by page role. Each form's syntax lives
      in the selected runtime authority's construction references.

      ---

      ## Phase Frame

      Every route is one Plan → Do·Check·Act cycle: Plan ends when every authoring
      input exists as a file or retained decision; Do authors pages, Check runs the
      route's gates, Act repairs at the owning layer (discipline 7), and the cycle
      ends at export. Step numbers stay as written.

      | Phase | Default | Quick | Edit Native | Create Template |
      |---|---|---|---|---|
      | **Plan** | Steps 1–5 | §2 | §1–4 | Steps 1–3 |
      | **Do·Check·Act** | Steps 6–7 | §3–4 | §5–7 | Steps 4–8 |

      ## Global Execution Discipline

      1. **Serial execution** — Follow the selected authority's steps in order. A completed non-blocking step may continue directly to the next eligible step.
      2. **Blocking means stop** — At every \`⛔ BLOCKING\` gate, wait for explicit user confirmation. Do not decide on the user's behalf.
      3. **No cross-phase bundling** — Do not combine work across an unclosed gate. Once the route's final user gate closes, later non-blocking steps may continue automatically.
      4. **Gate before entry** — Verify every listed prerequisite before entering a step.
      5. **No speculative execution** — Do not prepare later-phase artifacts before their owning step.
      6. **Deterministic routing** — Do not add a route-choice question when [\`routing.md\`](workflows/routing.md) resolves the request. If a route prerequisite is missing, state it and stop that route.
      7. **Act at the owning layer** — On failure, repair at the shallowest layer that owns the fault: the page for a page-local issue, the Plan artifact for a roster/spec/resource fault, the owning source artifact for a tool failure; then resume from the route's declared pointer. Do not silently downgrade a required artifact.

      ## Global Communication Rules

      - Match the user's language and source language unless the user explicitly overrides it.
      - Localize user-facing option labels and explanations. Keep exact enum IDs or field names when needed for precision.
      - Keep \`design_spec.md\` section headings and field names in the template's original English; content values may use the user's language.
      - Before switching roles, read the corresponding role reference and output:

      \`\`\`markdown
      ## [Role Switch: <Role Name>]
      📖 Reading role definition: references/<filename>.md
      📋 Current task: <brief description>
      \`\`\`

      ---

      ## Repository Compatibility

      - This package is a workflow/skill, not a generic application scaffold. Do not create \`.worktrees/\`, \`tests/\`, branch workflows, or generic engineering structure by default.
      - Keep required workflow, reference, script, and template documentation inside this Skill directory.
      - Repository-level documents may point into the package; package runtime files must not depend on repository-level instructions.
      - On Windows, if a documented \`python3 ...\` command is unavailable, rerun the same command with \`python\`.
      - Sponsor information is optional reference material. Read the matching [\`SPONSORS.md\`](SPONSORS.md) or [\`SPONSORS_CN.md\`](SPONSORS_CN.md) only when the user explicitly requests a model, AI image model, API/provider, or hosted-service recommendation. Never surface sponsor or model recommendations proactively during normal generation, troubleshooting, or quality review.
      ",
            "name": "ppt-master",
            "provider": "ppt-master",
            "resourceBase": {
              "kind": "directory",
              "path": "{{pptMasterAssetsPath}}",
            },
          },
        },
        "summary": {
          "description": "AI-driven presentation workflow for generating editable PPTX decks and slides, reconstructing page visuals, creating reusable Brand/Style/Layout/Deck workspaces, filling native PPTX templates, and enhancing finished PPTX files. Use when the user asks to create, generate, reconstruct, regenerate, beautify, redesign, template, fill, or enhance a presentation, PPT, PPTX, slide deck, or courseware — including adding narration or animation to one — requests a presentation-authored narrated/self-running video, or mentions ppt-master.",
          "invocation": {
            "modelInvocable": true,
            "userInvocable": true,
          },
          "name": "ppt-master",
          "provider": "ppt-master",
          "resourceBase": {
            "kind": "directory",
            "path": "{{pptMasterAssetsPath}}",
          },
          "source": "bundled",
        },
      }
    `)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})

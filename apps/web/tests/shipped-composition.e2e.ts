// Boots the shipped Web composition over the built dist this lane already uses
// and asserts what that composition produces: the model-visible tool catalog
// and file-reference guidance plus its HTTP, retry, sandbox, and approval defaults.
// No browser and no model call — these are composition facts, and the browser
// scenarios in this lane cover the surface itself.
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { canonicalPath, writableRoots } from '@deepseek-ai/dsh-sandbox'
import { SessionId } from '@deepseek-ai/dsh-session'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
// Empty type imports carry the tools/sandboxPolicy/approval Context merges.
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-client-modules'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'

const FILE_REFERENCE_PROMPT = fileURLToPath(new URL(
  './expected/web-runtime-context/file-reference-prompt.expected.md', import.meta.url,
))

/**
 * The catalog the shipped Web composition puts in front of the model, minus the
 * ripgrep-dependent pair below. The absences are deliberate, not incidental
 * gaps: the `cordis_*` toolset executes model-written JavaScript that no
 * sandbox row confines, and `mcp_*` servers spawn outside `ctx.shell`.
 * `web_fetch` is present because public-address enforcement and one-shot
 * approval now confine its model-selected request target. The composition
 * Agent Note owns the rationale and its sources.
 */
const EXPECTED_TOOLS = [
  'ask_user_question',
  'bash',
  'create_goal',
  'edit',
  'exit_plan_mode',
  'get_goal',
  'interrupt_agent',
  'job_kill',
  'job_list',
  'job_output',
  'list_agents',
  'ralph',
  'read',
  'read_image',
  'send_message',
  'skill',
  'subagent',
  'subagent_fork',
  'todo_write',
  'update_goal',
  'web_fetch',
  'web_search',
  'workflow',
  'write',
]

/**
 * `glob` and `grep` come from `dsh-tool-fs-search`, which spawns the PACKAGED
 * ripgrep binary (`@vscode/ripgrep`) through the subprocess seam, so the pair
 * is always present on every host — asserted as fixed members, not a host
 * dependency.
 */
const RIPGREP_TOOLS = ['glob', 'grep']

/** Product additions mounted with the default Agent preset. */
const EXPECTED_PRODUCT_AGENT_TOOLS = ['read_document']

/** Product additions mounted outside the official default Agent preset. */
const EXPECTED_GLOBAL_TOOLS = [
  'anysearch_batch_search',
  'anysearch_capabilities',
  'anysearch_search',
  'cancel_image_generation_task',
  'cron_add',
  'cron_list',
  'cron_remove',
  'cron_run',
  'edit_image',
  'generate_image',
  'get_image_generation_task',
  'qq_send_local_file',
  'teacher_daily_management',
  'teacher_question_image_read',
  'teacher_question_workbench',
  'teacher_score_analysis',
  'teacher_student_roster',
  'teacher_timetable',
  'teacher_workbench_read',
  'univer_api',
  'univer_compile_svg',
  'univer_execute',
  'univer_export',
  'univer_import',
  'univer_inspect',
  'univer_lint',
  'univer_new',
  'univer_resources',
  'univer_screenshot',
  'univer_status',
  'univer_unit',
  'univer_worktree',
]

/** Browser modules whose shipped-profile availability is release behavior. */
const EXPECTED_BUNDLED_CLIENT_MODULES = [
  '@deepseek-ai/dsh-client-ui-image-generation',
  '@dickpy/dsh-imagegen',
  '@huanlin/dsh-plugin-better-sidebar-plugin-office',
  '@xmanrui/dsh-im',
  'dsh-plugin-cron',
  'dsh-skill-mcp-panel',
  'dsh-univer-office',
]

let scaffold: WebScaffold | undefined
let windowsHarnessHome: string | undefined

beforeEach(() => {
  vi.stubEnv('DSH_WINDOWS_MCP_COMMAND', undefined)
  vi.stubEnv('DSH_WINDOWS_MCP_RUNTIME_ROOT', undefined)
})

afterEach(async () => {
  try {
    await scaffold?.close()
  } finally {
    scaffold = undefined
    vi.unstubAllEnvs()
    if (windowsHarnessHome !== undefined) await rm(windowsHarnessHome, { recursive: true, force: true })
    windowsHarnessHome = undefined
  }
})

it.skipIf(process.platform === 'win32')('starts the supplied desktop runtime by default and preserves a saved disable across launches', async () => {
  const command = fileURLToPath(new URL('../../../packages/mcp/windows-mcp/tests/fixtures/desktop-server.mjs', import.meta.url))
  vi.stubEnv('DSH_WINDOWS_MCP_COMMAND', command)
  vi.stubEnv('DSH_WINDOWS_MCP_RUNTIME_ROOT', tmpdir())
  windowsHarnessHome = await mkdtemp(join(tmpdir(), 'dsh-windows-mcp-home-'))
  scaffold = await launchWebScaffold({ deepSeekMissingCredential: true, harnessHome: windowsHarnessHome })
  const { ctx } = scaffold
  const namespace = settingsNamespace('windows-mcp')
  expect(ctx.settings.describe().find(row => row.ns === namespace)).toMatchObject({
    base: { enabled: true, runtimeCommand: command },
    value: { enabled: true },
  })
  expect(ctx.tools.get('mcp__windows__Snapshot')).toBeDefined()
  expect(ctx.tools.get('mcp__windows__PowerShell')).toBeDefined()

  await ctx.settings.update(namespace, { enabled: false })
  await vi.waitFor(() => { expect(ctx.tools.get('mcp__windows__Snapshot')).toBeUndefined() })
  expect(ctx.settings.describe().find(row => row.ns === namespace)).toMatchObject({
    value: { enabled: false },
    user: { enabled: false },
  })
  await scaffold.close()
  scaffold = undefined
  scaffold = await launchWebScaffold({ deepSeekMissingCredential: true, harnessHome: windowsHarnessHome })
  expect(scaffold.ctx.settings.describe().find(row => row.ns === namespace)).toMatchObject({
    base: { enabled: true },
    value: { enabled: false },
    user: { enabled: false },
  })
  expect(scaffold.ctx.tools.get('mcp__windows__Snapshot')).toBeUndefined()
  expect(scaffold.ctx.tools.get('mcp__windows__PowerShell')).toBeUndefined()
}, 60_000)

it('assembles the shipped Web transport, catalog, guidance, and defaults', async () => {
  scaffold = await launchWebScaffold({ deepSeekMissingCredential: true })
  const ctx = scaffold.ctx
  const index = await fetch(`http://127.0.0.1:${String(ctx.webServer.port)}`, {
    headers: { 'accept-encoding': 'gzip' },
  })
  expect(index.headers.get('content-encoding')).toBe('gzip')
  expect(index.headers.get('vary')).toContain('Accept-Encoding')
  await index.body?.cancel()
  expect(ctx.clientModules.graph().entries.map(entry => entry.id)).toEqual(
    expect.arrayContaining(EXPECTED_BUNDLED_CLIENT_MODULES),
  )
  expect(ctx.settings.describe().find(row => String(row.ns) === 'windows-mcp')).toMatchObject({
    base: {
      enabled: false,
      runtimeCommand: '',
      runtimeCwd: '',
      toolCallTimeoutMs: 180_000,
    },
  })
  expect(ctx.tools.schemas().map(schema => schema.name).some(name => name.startsWith('mcp__windows__')))
    .toBe(false)
  expect(await ctx.skills.list()).toContainEqual(expect.objectContaining({
    name: 'ppt-master',
    provider: 'ppt-master',
    source: 'bundled',
    invocation: { modelInvocable: true, userInvocable: true },
  }))
  expect(ctx.llm.providerRetryPolicy('deepseek-official')).toMatchInlineSnapshot(`
    {
      "initialDelayMs": 500,
      "jitterRatio": 0.1,
      "maxDelayMs": 10000,
      "maxRetries": 5,
      "mode": "normal",
      "retryableCodes": [
        "EMPTY_RESPONSE",
        "RATE_LIMIT",
        "SERVER",
        "TIMEOUT",
        "TRANSPORT",
      ],
    }
  `)
  await ctx.settings.update(settingsNamespace('llm-deepseek'), {
    retryPolicy: { mode: 'always', maxRetries: 5 },
  })
  expect(ctx.llm.providerRetryPolicy('deepseek-official')).toMatchInlineSnapshot(`
    {
      "initialDelayMs": 500,
      "jitterRatio": 0.1,
      "maxDelayMs": 10000,
      "mode": "always",
    }
  `)
  await ctx.settings.update(settingsNamespace('llm-pi-ai'), {
    providers: {
      openai: {},
      anthropic: { retryPolicy: { mode: 'always' } },
    },
  })
  expect(ctx.llm.providerRetryPolicy('openai')).toMatchInlineSnapshot(`
    {
      "initialDelayMs": 500,
      "jitterRatio": 0.1,
      "maxDelayMs": 10000,
      "maxRetries": 5,
      "mode": "normal",
      "retryableCodes": [
        "EMPTY_RESPONSE",
        "RATE_LIMIT",
        "SERVER",
        "TIMEOUT",
        "TRANSPORT",
      ],
    }
  `)
  expect(ctx.llm.providerRetryPolicy('anthropic')).toMatchInlineSnapshot(`
    {
      "initialDelayMs": 500,
      "jitterRatio": 0.1,
      "maxDelayMs": 10000,
      "mode": "always",
    }
  `)
  // The catalog belongs to an AGENT, not to the process: every model-facing row
  // now lives in a preset mounted under one session's scope, so the global
  // layer holds nothing and a caller must name the agent to see anything. This
  // composes from the deployment default — what a session that names no preset
  // gets — which is the shape this test has always been about.
  expect(ctx.tools.schemas().map(schema => schema.name).sort()).toEqual(EXPECTED_GLOBAL_TOOLS)
  const handle = await ctx.agents.create({
    sessionId: SessionId('shipped-composition'),
    setup: agentCtx => ctx.agentPresets.mount(agentCtx).then(() => undefined),
  })
  try {
    const names = ctx.tools.schemas(handle.agent).map(schema => schema.name).sort()
    expect(names.filter(name => !RIPGREP_TOOLS.includes(name))).toEqual(
      [...EXPECTED_TOOLS, ...EXPECTED_PRODUCT_AGENT_TOOLS, ...EXPECTED_GLOBAL_TOOLS].sort(),
    )
    // The packaged ripgrep binary ships with the dependency, so the pair is a
    // fixed roster member on every host.
    expect(names.filter(name => RIPGREP_TOOLS.includes(name))).toEqual(RIPGREP_TOOLS)
    const pptMaster = await ctx.skills.get('ppt-master', { scope: handle.agent })
    expect(pptMaster).toMatchObject({
      name: 'ppt-master',
      metadata: { version: '6.1.0', license: 'MIT' },
      resourceBase: { kind: 'directory' },
    })
    expect(pptMaster?.content).toContain('# PPT Master Skill')
    const fileReferenceSection = (await ctx.systemPrompt.assemble({ scope: handle.agent })).sections
      .find(section => section.name === 'ui:deliverable-file-references')
    expect(fileReferenceSection?.text).toBe(readFileSync(FILE_REFERENCE_PROMPT, 'utf8').trimEnd())
  } finally {
    await handle.dispose()
  }
  // `workspace-write` is not "the workspace and nothing else": the shared roots
  // helper always admits the temp directories too. Pinning it against an
  // explicit mode keeps the claim independent of this surface's default, and
  // keeps a future sandbox-confinement test from being run inside /tmp — where an
  // "escape" write succeeds by design and reads as a sandbox failure.
  expect(writableRoots(scaffold.ctx.sandboxPolicy.resolve({ mode: 'workspace-write' }))).toEqual(
    expect.arrayContaining([canonicalPath('/tmp'), canonicalPath(tmpdir())]),
  )
  expect(scaffold.ctx.sandboxPolicy.defaultMode).toBe('workspace-write')
  expect(scaffold.ctx.approval.config.policy).toBe('ask')
  expect(scaffold.ctx.permissionPresets.defaultPreset).toBe('workspace-write')

  const commandHandle = await scaffold.ctx.agents.create({
    sessionId: SessionId('shipped-command-catalog'),
    meta: { cwd: scaffold.workspaceCwd },
    agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  })
  try {
    expect(scaffold.ctx.commands.list(commandHandle.agent)).toContainEqual({
      name: 'feedback',
      description: 'record feedback about this session',
      input: { hint: '<text>' },
    })
  } finally {
    await commandHandle.dispose()
  }
}, 120_000)

it('lets a preset producer reach the background-job registry', async () => {
  scaffold = await launchWebScaffold()
  const ctx = scaffold.ctx
  const handle = await ctx.agents.create({
    sessionId: SessionId('shipped-background-job'),
    meta: { cwd: scaffold.workspaceCwd },
    setup: agentCtx => ctx.agentPresets.mount(agentCtx).then(() => undefined),
  })
  try {
    const signal = new AbortController().signal
    // `tool-bash` is a preset row and `tasks` is a host registry; the producer
    // resolves it with `ctx.get`, so a registry hidden behind a preset realm
    // fails here — with every task control still listed in the catalog above.
    const started = await ctx.tools.execute({
      signal,
      callId: ToolCallId('shipped-bash-background'),
      name: 'bash',
      arguments: {
        command: 'printf SHIPPED_BACKGROUND_OK',
        description: 'shipped background probe',
        run_in_background: true,
      },
      agent: handle.agent,
    })
    expect({ isError: started.isError, content: started.content }).toEqual({
      isError: false,
      content: [{ type: 'text', text: 'started background job bash-1' }],
    })

    // The controller reads what the producer started: same registry, one
    // owner. A per-preset registry would list nothing here even on success.
    const listed = await ctx.tools.execute({
      signal,
      callId: ToolCallId('shipped-task-list'),
      name: 'job_list',
      arguments: {},
      agent: handle.agent,
    })
    expect(listed.isError).toBe(false)
    expect(listed.content).toEqual([
      { type: 'text', text: expect.stringContaining('bash-1 [bash]') as unknown as string },
    ])

    // The full round trip: the output a host-plane producer wrote is collected
    // through a preset-plane control, which is the linkage the realm severed.
    const collected = await ctx.tools.execute({
      signal,
      callId: ToolCallId('shipped-task-output'),
      name: 'job_output',
      arguments: { job_id: 'bash-1', wait: true },
      agent: handle.agent,
    })
    expect(collected.isError).toBe(false)
    expect(collected.content).toEqual([
      { type: 'text', text: expect.stringContaining('SHIPPED_BACKGROUND_OK') as unknown as string },
    ])
  } finally {
    await handle.dispose()
  }
}, 120_000)

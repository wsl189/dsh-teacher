/** Consecutive-root summary and root/subcall composition over one atomic dispatch path. */
import { memo, useMemo, useState, type ReactNode } from 'react'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { DisclosureRow, IconSparkle16, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallOwnerProps, ToolGroupProps, ToolTreeProps } from '../contract/slots.ts'
import { classifyTool, type ToolRowVariant } from './models/tool-call-model.ts'
import { GenericToolCard } from './toolviews/GenericToolCard.tsx'
import css from './ToolCallTree.module.css'

/** Resolve a Tool call's wire name from either lifecycle form. */
function callName(node: ToolCallBlock): string {
  return 'kind' in node ? node.call?.name ?? '' : node.name
}

type GroupAction = 'change' | 'read' | 'search' | 'command' | 'code' | 'tool'

const ACTION_BY_VARIANT: Record<ToolRowVariant, GroupAction> = {
  edit: 'change',
  write: 'change',
  read: 'read',
  search: 'search',
  bash: 'command',
  code: 'code',
  others: 'tool',
}

/** Infer a generic action for unregistered domain Tool names without interpreting their arguments. */
function groupAction(toolName: string): GroupAction {
  const known = classifyTool(toolName)
  if (known !== 'others') return ACTION_BY_VARIANT[known]
  const tokens = toolName.toLowerCase().split(/[^a-z0-9]+/u)
  if (tokens.some(token => ['edit', 'write', 'patch', 'replace', 'erase', 'delete', 'remove', 'create', 'apply'].includes(token))) {
    return 'change'
  }
  if (tokens.some(token => ['read', 'fetch', 'open', 'inspect', 'view', 'load'].includes(token))) return 'read'
  if (tokens.some(token => ['search', 'grep', 'glob', 'find', 'query', 'lookup', 'list'].includes(token))) return 'search'
  if (tokens.some(token => ['bash', 'pwsh', 'shell', 'command', 'terminal', 'exec', 'run'].includes(token))) return 'command'
  return 'tool'
}

/** Flatten recursive Code Dispatch calls in the same order as the expanded tree. */
function flattenCalls(blocks: readonly ToolCallBlock[]): readonly ToolCallBlock[] {
  const calls: ToolCallBlock[] = []
  const visit = (block: ToolCallBlock): void => {
    calls.push(block)
    for (const child of block.subCalls) visit(child)
  }
  for (const block of blocks) visit(block)
  return calls
}

function actionText(action: GroupAction, running: boolean, t: ToolGroupProps['t']): string {
  switch (action) {
    case 'change': return t(running ? 'toolGroup.change.running' : 'toolGroup.change.done')
    case 'read': return t(running ? 'toolGroup.read.running' : 'toolGroup.read.done')
    case 'search': return t(running ? 'toolGroup.search.running' : 'toolGroup.search.done')
    case 'command': return t(running ? 'toolGroup.command.running' : 'toolGroup.command.done')
    case 'code': return t(running ? 'toolGroup.code.running' : 'toolGroup.code.done')
    case 'tool': return t(running ? 'toolGroup.tool.running' : 'toolGroup.tool.done')
  }
}

function groupSummary(calls: readonly ToolCallBlock[], t: ToolGroupProps['t']): {
  readonly text: string
  readonly state: 'running' | 'ok' | 'error' | 'stopped'
} {
  const running = calls.some(call => !('kind' in call))
  const counts = new Map<GroupAction, number>()
  let failed = 0
  let stopped = 0
  for (const call of calls) {
    const action = groupAction(callName(call))
    counts.set(action, (counts.get(action) ?? 0) + 1)
    if (!('kind' in call) || !call.isError) continue
    if (call.error?.code === 'interrupted') stopped += 1
    else failed += 1
  }
  const parts = [...counts].map(([action, count]) => (
    `${actionText(action, running, t)}${count > 1 ? ` ×${count}` : ''}`
  ))
  if (failed > 0) parts.push(t('toolGroup.failed', { count: failed }))
  if (stopped > 0) parts.push(t('toolGroup.stopped', { count: stopped }))
  return {
    text: parts.join(t('toolGroup.separator')),
    state: running ? 'running' : failed > 0 ? 'error' : stopped > 0 ? 'stopped' : 'ok',
  }
}

function groupIcon(state: ReturnType<typeof groupSummary>['state']): ReactNode {
  if (state === 'error') return <StateDot state="error" />
  if (state === 'stopped') return <StateDot state="warning" />
  return <IconSparkle16 size={14} />
}

/** One atomic call dispatched through the Tool-owned keyed slot. */
const ToolCall = memo(function ToolCall({
  renderSlot, callId, toolName, block, openFile, selected, cwd, home, inspectCall, t, children,
}: Pick<ToolTreeProps, 'renderSlot' | 'openFile' | 'cwd' | 'inspectCall' | 't'> & {
  callId: string
  toolName: string
  block: ToolCallBlock
  selected: boolean
  home?: string | undefined
  children?: ReactNode
}) {
  const owner: ToolCallOwnerProps = useMemo(() => ({
    callId,
    toolName,
    block,
    openFile,
    cwd,
    home,
    inspect: () => { inspectCall(callId) },
  }), [callId, toolName, block, openFile, cwd, home, inspectCall])
  return (
    <div
      className={css.callRow}
      data-chat-anchor-key={`call:${callId}`}
      data-chat-call-id={callId}
      data-selected={selected || undefined}
    >
      {renderSlot('tool.call.toolview', owner, {
        entryKey: toolName,
        fallback: <GenericToolCard {...owner} t={t} />,
      })}
      {children}
    </div>
  )
})

const ToolCallBranch = memo(function ToolCallBranch({
  renderSlot, block, selectedCallId, cwd, home, openFile, inspectCall, t,
}: Pick<ToolTreeProps, 'renderSlot' | 'selectedCallId' | 'cwd' | 'openFile' | 'inspectCall' | 't'> & {
  block: ToolCallBlock
  home?: string | undefined
}) {
  return (
    <ToolCall
      renderSlot={renderSlot}
      callId={block.callId}
      toolName={callName(block)}
      block={block}
      openFile={openFile}
      selected={block.callId === selectedCallId}
      cwd={cwd}
      home={home}
      inspectCall={inspectCall}
      t={t}
    >
      {block.subCalls.length > 0 ? (
        <div className={css.subCalls} data-subcalls>
          {block.subCalls.map(child => (
            <ToolCallBranch
              key={child.callId}
              renderSlot={renderSlot}
              block={child}
              selectedCallId={selectedCallId}
              cwd={cwd}
              home={home}
              openFile={openFile}
              inspectCall={inspectCall}
              t={t}
            />
          ))}
        </div>
      ) : null}
    </ToolCall>
  )
})

type ToolNodeSeatProps = Pick<
  ToolGroupProps,
  'useSession' | 'renderSlot' | 'selectedCallId' | 'cwd' | 'openFile' | 'inspectCall' | 't'
> & {
  readonly nodeKey: string
  readonly home?: string | undefined
}

/** Subscribe one root call so sibling lifecycle updates retain their component state. */
const ToolNodeSeat = memo(function ToolNodeSeat({
  useSession, renderSlot, nodeKey, selectedCallId, cwd, home, openFile, inspectCall, t,
}: ToolNodeSeatProps) {
  const raw = useSession(snapshot => snapshot.chat.nodes.get(nodeKey))
  const node = raw as ChatNode | undefined
  if (node?.kind !== 'tool-call') return null
  return (
    <ToolCallBranch
      renderSlot={renderSlot}
      block={node.data.root}
      selectedCallId={selectedCallId}
      cwd={cwd}
      home={home}
      openFile={openFile}
      inspectCall={inspectCall}
      t={t}
    />
  )
})

/**
 * Render one maximal consecutive Tool run. A single atomic root remains a
 * normal row; multi-call work is summarized until the user expands it.
 * @param props - grouped Chat identities, Tool child slot, and Host actions.
 * @returns a direct Tool row or a summary disclosure containing the call trees.
 */
export function ToolCallGroup({
  useSession, renderSlot, nodeKeys, selectedCallId, cwd, openFile, inspectCall, useHostDescription, t,
}: ToolGroupProps) {
  const allNodes = useSession(snapshot => snapshot.chat.nodes.values())
  const blocks = useMemo(() => {
    const wanted = new Set(nodeKeys)
    const byKey = new Map(allNodes.filter(node => wanted.has(node.key)).map(node => [node.key, node]))
    return nodeKeys.flatMap((nodeKey) => {
      const node = byKey.get(nodeKey) as ChatNode | undefined
      return node?.kind === 'tool-call' ? [node.data.root] : []
    })
  }, [allNodes, nodeKeys])
  const calls = useMemo(() => flattenCalls(blocks), [blocks])
  const summary = useMemo(() => groupSummary(calls, t), [calls, t])
  const [open, setOpen] = useState(false)
  const home = useHostDescription(description => description?.home)
  const grouped = calls.length > 1
  const trees = nodeKeys.map(nodeKey => (
    <ToolNodeSeat
      key={nodeKey}
      useSession={useSession}
      renderSlot={renderSlot}
      nodeKey={nodeKey}
      selectedCallId={selectedCallId}
      cwd={cwd}
      home={home}
      openFile={openFile}
      inspectCall={inspectCall}
      t={t}
    />
  ))
  if (!grouped) return trees
  return (
    <div className={css.group} data-tool-group="" data-state={summary.state}>
      <DisclosureRow
        icon={groupIcon(summary.state)}
        title={summary.text}
        open={open}
        expandable
        expandOnRowClick
        rowClassName={css.groupRow}
        titleClassName={css.groupTitle}
        chevronClassName={css.groupChevron}
        onToggle={() => { setOpen(value => !value) }}
      >
        <div className={css.groupCalls}>{trees}</div>
      </DisclosureRow>
    </div>
  )
}

/**
 * Render one root Tool call and its recursive children through the same
 * atomic keyed dispatch.
 * @param props - whole-Tool owner data and the Tool-owned child-slot share.
 * @returns the Tool call tree.
 */
export function ToolCallTree({
  renderSlot, node, selectedCallId, cwd, openFile, inspectCall, useHostDescription, t,
}: ToolTreeProps) {
  const home = useHostDescription(description => description?.home)
  const block = node.data.root
  return (
    <ToolCallBranch
      renderSlot={renderSlot}
      block={block}
      selectedCallId={selectedCallId}
      cwd={cwd}
      home={home}
      openFile={openFile}
      inspectCall={inspectCall}
      t={t}
    />
  )
}

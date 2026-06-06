import * as React from 'react'
import type { CommandResultDisplay } from '../../commands.js'
import { useElapsedTime } from '../../hooks/useElapsedTime.js'
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js'
import { Box, Text } from '../../ink.js'
import { useKeybindings } from '../../keybindings/useKeybinding.js'
import type { LocalWorkflowTaskState } from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import type {
  WorkflowAgentSnapshot,
  WorkflowSnapshot,
} from '../../tools/WorkflowTool/display.js'
import type { DeepImmutable } from '../../types/utils.js'
import { formatNumber } from '../../utils/format.js'
import { Byline } from '../design-system/Byline.js'
import { Dialog } from '../design-system/Dialog.js'
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js'
import { getTaskStatusColor, getTaskStatusIcon } from './taskStatusUtils.js'

type Props = {
  workflow: DeepImmutable<LocalWorkflowTaskState>
  onDone: (
    result?: string,
    options?: {
      display?: CommandResultDisplay
    },
  ) => void
  onKill?: () => void
  onSkipAgent?: (agentId: number) => void
  onRetryAgent?: (agentId: number) => void
  onBack?: () => void
}

export function WorkflowDetailDialog({
  workflow,
  onDone,
  onKill,
  onBack,
}: Props): React.ReactNode {
  const elapsedTime = useElapsedTime(
    workflow.startTime,
    workflow.status === 'running',
    1000,
    workflow.totalPausedMs ?? 0,
  )
  const handleClose = () =>
    onDone('Workflow details dismissed', { display: 'system' })

  useKeybindings(
    {
      'confirm:yes': handleClose,
    },
    { context: 'Confirmation' },
  )

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === ' ') {
      event.preventDefault()
      handleClose()
      return
    }
    if (event.key === 'left' && onBack) {
      event.preventDefault()
      onBack()
      return
    }
    if (event.key === 'x' && workflow.status === 'running' && onKill) {
      event.preventDefault()
      onKill()
    }
  }

  const snapshot = workflow.snapshot
  const title = (
    <Text>
      workflow › {workflow.workflowName || snapshot.name || workflow.description}
    </Text>
  )
  const subtitle = (
    <Text>
      {workflow.status !== 'running' ? (
        <Text color={getTaskStatusColor(workflow.status)}>
          {getTaskStatusIcon(workflow.status)} {statusLabel(workflow.status)} ·{' '}
        </Text>
      ) : null}
      <Text dimColor>
        {elapsedTime} · {formatNumber(snapshot.done)}/{formatNumber(snapshot.total)}{' '}
        agents
      </Text>
    </Text>
  )

  return (
    <Box
      flexDirection="column"
      tabIndex={0}
      autoFocus
      onKeyDown={handleKeyDown}
    >
      <Dialog
        title={title}
        subtitle={subtitle}
        onCancel={handleClose}
        color="background"
        inputGuide={exitState =>
          exitState.pending ? (
            <Text>Press {exitState.keyName} again to exit</Text>
          ) : (
            <Byline>
              {onBack ? (
                <KeyboardShortcutHint shortcut="←" action="go back" />
              ) : null}
              <KeyboardShortcutHint shortcut="Esc/Enter/Space" action="close" />
              {workflow.status === 'running' && onKill ? (
                <KeyboardShortcutHint shortcut="x" action="stop" />
              ) : null}
            </Byline>
          )
        }
      >
        <WorkflowPhases snapshot={snapshot} />
      </Dialog>
    </Box>
  )
}

function WorkflowPhases({
  snapshot,
}: {
  snapshot: DeepImmutable<WorkflowSnapshot>
}): React.ReactNode {
  const phases = getPhaseGroups(snapshot)

  if (phases.length === 0) {
    return <Text dimColor>No workflow agents have started yet.</Text>
  }

  return (
    <Box flexDirection="column">
      {phases.map((phase, index) => (
        <Box
          key={`${phase.title}-${index}`}
          flexDirection="column"
          marginTop={index === 0 ? 0 : 1}
        >
          <Text>
            {phaseStatusIcon(phase.agents)}{' '}
            <Text bold>{phase.title}</Text>{' '}
            <Text dimColor>
              {phase.agents.filter(agent => agent.status !== 'running').length}/
              {phase.agents.length}
            </Text>
          </Text>
          {phase.agents.length === 0 ? (
            <Text dimColor>  No agents started</Text>
          ) : (
            phase.agents.map(agent => (
              <AgentRow key={`${agent.id}-${agent.label}`} agent={agent} />
            ))
          )}
        </Box>
      ))}
      {snapshot.logs.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>log: {snapshot.logs.at(-1)}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

function AgentRow({
  agent,
}: {
  agent: DeepImmutable<WorkflowAgentSnapshot>
}): React.ReactNode {
  return (
    <Text>
      {'  '}
      <Text color={agentStatusColor(agent.status)}>{agentStatusIcon(agent)}</Text>{' '}
      <Text>{agent.label}</Text>
      {agent.status === 'running' ? null : agent.error ? (
        <Text dimColor> · {agent.error}</Text>
      ) : agent.resultPreview ? (
        <Text dimColor> · {agent.resultPreview}</Text>
      ) : null}
    </Text>
  )
}

function getPhaseGroups(snapshot: DeepImmutable<WorkflowSnapshot>): Array<{
  title: string
  agents: DeepImmutable<WorkflowAgentSnapshot[]>
}> {
  const declared = snapshot.phases.map(title => ({
    title,
    agents: snapshot.agents.filter(agent => agent.phase === title),
  }))
  const unphased = snapshot.agents.filter(agent => !agent.phase)
  return unphased.length === 0
    ? declared
    : [...declared, { title: 'Unphased', agents: unphased }]
}

function phaseStatusIcon(
  agents: DeepImmutable<WorkflowAgentSnapshot[]>,
): string {
  if (agents.length === 0) return '-'
  if (agents.some(agent => agent.status === 'error')) return '!'
  if (agents.some(agent => agent.status === 'running')) return '*'
  if (agents.every(agent => agent.status === 'done')) return '+'
  return '-'
}

function agentStatusIcon(agent: DeepImmutable<WorkflowAgentSnapshot>): string {
  switch (agent.status) {
    case 'done':
      return '+'
    case 'error':
      return '!'
    case 'skipped':
      return '-'
    case 'running':
      return '*'
  }
}

function agentStatusColor(
  status: WorkflowAgentSnapshot['status'],
): 'success' | 'error' | 'warning' | 'background' {
  switch (status) {
    case 'done':
      return 'success'
    case 'error':
      return 'error'
    case 'skipped':
      return 'warning'
    case 'running':
      return 'background'
  }
}

function statusLabel(status: LocalWorkflowTaskState['status']): string {
  switch (status) {
    case 'completed':
      return 'Completed'
    case 'failed':
      return 'Failed'
    case 'killed':
      return 'Stopped'
    case 'running':
      return 'Running'
  }
}

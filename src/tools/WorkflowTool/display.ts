export interface WorkflowAgentSnapshot {
  id: number
  label: string
  phase?: string
  prompt: string
  status: 'running' | 'done' | 'error' | 'skipped'
  resultPreview?: string
  error?: string
}

export interface WorkflowSnapshot {
  name: string
  description: string
  phases: string[]
  currentPhase?: string
  agents: WorkflowAgentSnapshot[]
  logs: string[]
  result?: unknown
  durationMs?: number
  done: number
  total: number
}

export function createWorkflowSnapshot(meta: {
  name: string
  description: string
  phases?: Array<{ title: string }>
}): WorkflowSnapshot {
  return recomputeWorkflowSnapshot({
    name: meta.name,
    description: meta.description,
    phases: meta.phases?.map(phase => phase.title) ?? [],
    agents: [],
    logs: [],
    done: 0,
    total: 0,
  })
}

export function recomputeWorkflowSnapshot(
  snapshot: WorkflowSnapshot,
): WorkflowSnapshot {
  const total = snapshot.agents.length
  const done = snapshot.agents.filter(agent => agent.status !== 'running').length
  return { ...snapshot, total, done }
}

export function preview(value: unknown): string {
  if (value == null) return String(value)
  if (typeof value === 'string') return compact(value)
  try {
    return compact(JSON.stringify(value))
  } catch {
    return compact(String(value))
  }
}

export function renderWorkflowText(
  snapshot: WorkflowSnapshot,
  complete = false,
): string {
  const status = complete ? 'completed' : `${snapshot.done}/${snapshot.total} done`
  const lines = [`Workflow: ${snapshot.name} (${status})`]
  const phases = snapshot.phases.length
    ? snapshot.phases
    : unique(snapshot.agents.map(agent => agent.phase).filter(isString))

  for (const phase of phases) {
    const agents = snapshot.agents.filter(agent => agent.phase === phase)
    const phaseDone = agents.filter(agent => agent.status !== 'running').length
    lines.push(`  ${phaseStatus(agents)} ${phase} ${phaseDone}/${agents.length}`)
    for (const agent of agents) {
      lines.push(`    #${agent.id} ${agentStatus(agent)} ${agent.label}`)
    }
  }

  const unphased = snapshot.agents.filter(agent => !agent.phase)
  for (const agent of unphased) {
    lines.push(`  #${agent.id} ${agentStatus(agent)} ${agent.label}`)
  }

  for (const log of snapshot.logs.slice(-1)) {
    lines.push(`  log: ${compact(log)}`)
  }

  if (complete && snapshot.durationMs !== undefined) {
    lines.push(`  duration_ms: ${snapshot.durationMs}`)
  }

  return lines.join('\n')
}

function phaseStatus(agents: WorkflowAgentSnapshot[]): string {
  if (agents.length === 0) return '-'
  if (agents.every(agent => agent.status === 'done')) return '+'
  if (agents.some(agent => agent.status === 'error')) return '!'
  if (agents.some(agent => agent.status === 'running')) return '*'
  return '-'
}

function agentStatus(agent: WorkflowAgentSnapshot): string {
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

function compact(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

import {
  createTaskStateBase,
  generateTaskId,
  type SetAppState,
  type Task,
  type TaskStateBase,
} from '../../Task.js'
import type { WorkflowSnapshot } from '../../tools/WorkflowTool/display.js'
import { registerTask, updateTaskState } from '../../utils/task/framework.js'

export type LocalWorkflowTaskState = TaskStateBase & {
  type: 'local_workflow'
  status: 'running' | 'completed' | 'failed' | 'killed'
  workflowName: string
  summary?: string
  snapshot: WorkflowSnapshot
  agentCount: number
  abortController?: AbortController
}

export function registerWorkflowTask({
  description,
  snapshot,
  setAppState,
  abortController,
  toolUseId,
}: {
  description: string
  snapshot: WorkflowSnapshot
  setAppState: SetAppState
  abortController?: AbortController
  toolUseId?: string
}): LocalWorkflowTaskState {
  const taskId = generateTaskId('local_workflow')
  const task: LocalWorkflowTaskState = {
    ...createTaskStateBase(taskId, 'local_workflow', description, toolUseId),
    type: 'local_workflow',
    status: 'running',
    workflowName: snapshot.name,
    summary: workflowSummary(snapshot),
    snapshot,
    agentCount: snapshot.total,
    abortController,
  }
  registerTask(task, setAppState)
  return task
}

export function updateWorkflowTaskSnapshot(
  taskId: string,
  snapshot: WorkflowSnapshot,
  setAppState: SetAppState,
): void {
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, task => {
    if (task.type !== 'local_workflow' || task.status !== 'running') return task
    return {
      ...task,
      workflowName: snapshot.name,
      summary: workflowSummary(snapshot),
      snapshot,
      agentCount: snapshot.total,
    }
  })
}

export function completeWorkflowTask(
  taskId: string,
  snapshot: WorkflowSnapshot,
  setAppState: SetAppState,
): void {
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, task => {
    if (task.type !== 'local_workflow' || task.status !== 'running') return task
    return {
      ...task,
      status: 'completed',
      endTime: Date.now(),
      workflowName: snapshot.name,
      summary: workflowSummary(snapshot),
      snapshot,
      agentCount: snapshot.total,
    }
  })
}

export function failWorkflowTask(
  taskId: string,
  snapshot: WorkflowSnapshot,
  error: string,
  setAppState: SetAppState,
): void {
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, task => {
    if (task.type !== 'local_workflow' || task.status !== 'running') return task
    return {
      ...task,
      status: 'failed',
      endTime: Date.now(),
      summary: error,
      snapshot,
    }
  })
}

export function stopWorkflowTask(
  taskId: string,
  snapshot: WorkflowSnapshot,
  setAppState: SetAppState,
): void {
  updateTaskState<LocalWorkflowTaskState>(taskId, setAppState, task => {
    if (task.type !== 'local_workflow' || task.status !== 'running') return task
    return {
      ...task,
      status: 'killed',
      endTime: Date.now(),
      summary: 'aborted',
      snapshot,
    }
  })
}

export async function killWorkflowTask(
  taskId: string,
  setAppState: SetAppState,
): Promise<void> {
  let abortController: AbortController | undefined
  setAppState(prev => {
    const task = prev.tasks?.[taskId]
    if (!task || task.type !== 'local_workflow') return prev
    abortController = task.abortController
    return {
      ...prev,
      tasks: {
        ...prev.tasks,
        [taskId]: {
          ...task,
          status: 'killed',
          endTime: Date.now(),
        },
      },
    }
  })
  abortController?.abort()
}

export async function skipWorkflowAgent(): Promise<void> {}

export async function retryWorkflowAgent(): Promise<void> {}

export const LocalWorkflowTask: Task = {
  name: 'Workflow',
  type: 'local_workflow',
  kill: killWorkflowTask,
}

function workflowSummary(snapshot: WorkflowSnapshot): string {
  if (snapshot.total === 0) return snapshot.description
  return `${snapshot.done}/${snapshot.total} agents`
}

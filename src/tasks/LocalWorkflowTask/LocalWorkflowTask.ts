import type { SetAppState, Task, TaskStateBase } from '../../Task.js'

export type LocalWorkflowTaskState = TaskStateBase & {
  type: 'local_workflow'
}

export async function killWorkflowTask(
  taskId: string,
  setAppState: SetAppState,
): Promise<void> {
  setAppState(prev => {
    const task = prev.tasks?.[taskId]
    if (!task || task.type !== 'local_workflow') return prev
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
}

export async function skipWorkflowAgent(): Promise<void> {}

export async function retryWorkflowAgent(): Promise<void> {}

export const LocalWorkflowTask: Task = {
  name: 'Workflow',
  type: 'local_workflow',
  kill: killWorkflowTask,
}

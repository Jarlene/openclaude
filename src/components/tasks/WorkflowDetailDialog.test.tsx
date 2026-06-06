import React from 'react'
import { describe, expect, it } from 'bun:test'
import { AppStateProvider } from '../../state/AppState.js'
import { renderToString } from '../../utils/staticRender.js'
import { WorkflowDetailDialog } from './WorkflowDetailDialog.js'
import type { LocalWorkflowTaskState } from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'

describe('WorkflowDetailDialog', () => {
  it('shows agents grouped under their workflow phases', async () => {
    const started = Date.now()
    const workflow: LocalWorkflowTaskState = {
      id: 'w123',
      type: 'local_workflow',
      status: 'running',
      description: 'Build paper manager',
      workflowName: 'build_paper_manager',
      summary: '1/2 agents',
      agentCount: 2,
      startTime: started,
      outputFile: '/tmp/w123.out',
      outputOffset: 0,
      notified: false,
      snapshot: {
        name: 'build_paper_manager',
        description: 'Build paper manager',
        phases: ['初始化项目结构', '后端核心代码'],
        currentPhase: '初始化项目结构',
        logs: [],
        done: 1,
        total: 2,
        agents: [
          {
            id: 1,
            label: '创建目录结构',
            phase: '初始化项目结构',
            prompt: 'Create directories',
            status: 'done',
            resultPreview: 'ok',
          },
          {
            id: 2,
            label: '数据模型',
            phase: '后端核心代码',
            prompt: 'Implement models',
            status: 'running',
          },
        ],
      },
    }

    const output = await renderToString(
      <AppStateProvider>
        <WorkflowDetailDialog workflow={workflow} onDone={() => undefined} />
      </AppStateProvider>,
      120,
    )

    expect(output).toContain('workflow › build_paper_manager')
    expect(output).toContain('初始化项目结构')
    expect(output).toContain('创建目录结构')
    expect(output).toContain('后端核心代码')
    expect(output).toContain('数据模型')
  })
})

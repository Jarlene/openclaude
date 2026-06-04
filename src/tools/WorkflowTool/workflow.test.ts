import { describe, expect, test } from 'bun:test'
import {
  WORKFLOW_PROMPT_GUIDELINES,
  WorkflowTool,
} from './WorkflowTool.js'
import { parseWorkflowScript, runWorkflow } from './workflow.js'

test('parses literal meta and strips export from executable body', () => {
  const parsed = parseWorkflowScript(`
export const meta = {
  name: 'inspect_project',
  description: 'Inspect a repository',
  phases: [{ title: 'Scan' }],
}

phase('Scan')
return await agent('inventory', { label: 'repo inventory' })
`)

  expect(parsed.meta).toEqual({
    name: 'inspect_project',
    description: 'Inspect a repository',
    phases: [{ title: 'Scan' }],
  })
  expect(parsed.body).not.toContain('export const meta')
})

test('rejects nondeterministic workflow scripts', () => {
  expect(() =>
    parseWorkflowScript(`
export const meta = { name: 'bad', description: 'bad' }
return Date.now()
`),
  ).toThrow('Workflow scripts must be deterministic')

  expect(() =>
    parseWorkflowScript(`
export const meta = { name: 'bad', description: 'bad' }
return Math.random()
`),
  ).toThrow('Workflow scripts must be deterministic')
})

test('runs phase, parallel, pipeline, log, args, and budget globals', async () => {
  const starts: string[] = []
  const ends: unknown[] = []
  const phases: string[] = []
  const logs: string[] = []

  const result = await runWorkflow(
    `
export const meta = {
  name: 'demo_workflow',
  description: 'Demo workflow',
}

phase('Scan')
log('starting ' + args.topic)
const first = await agent('first ' + cwd, { label: 'first task' })
const many = await parallel(['a', 'b'].map(item => () => agent(item, { label: 'task ' + item })))
const piped = await pipeline(['x'], item => agent(item, { label: 'pipe one' }), prev => prev + '-done')
return { first, many, piped, remaining: budget.remaining() }
`,
    {
      cwd: '/tmp/work',
      args: { topic: 'repo' },
      agent: {
        async run(prompt) {
          return `result:${prompt}`
        },
      },
      onPhase: title => phases.push(title),
      onLog: message => logs.push(message),
      onAgentStart: event => starts.push(event.label),
      onAgentEnd: event => ends.push(event.result),
    },
  )

  expect(result.meta.name).toBe('demo_workflow')
  expect(result.agentCount).toBe(4)
  expect(result.phases).toEqual(['Scan'])
  expect(phases).toEqual(['Scan'])
  expect(logs).toEqual(['starting repo'])
  expect(starts).toEqual(['first task', 'task a', 'task b', 'pipe one'])
  expect(ends).toHaveLength(4)
  expect(result.result).toEqual({
    first: 'result:first /tmp/work',
    many: ['result:a', 'result:b'],
    piped: ['result:x-done'],
    remaining: Infinity,
  })
})

test('parallel rejects promises instead of thunks', async () => {
  await expect(
    runWorkflow(
      `
export const meta = { name: 'bad_parallel', description: 'Bad parallel' }
return await parallel([agent('oops')])
`,
      {
        agent: {
          async run(prompt) {
            return prompt
          },
        },
      },
    ),
  ).rejects.toThrow('parallel() expects an array of functions')
})

describe('workflow prompt', () => {
  test('keeps source project workflow guidelines intact', async () => {
    expect(WORKFLOW_PROMPT_GUIDELINES).toContain(
      'Use workflow only when the user explicitly asks for a workflow, workflows, fan-out, or multi-agent orchestration.',
    )
    expect(WORKFLOW_PROMPT_GUIDELINES).toContain(
      "For workflow, parallel() takes functions, not promises: use `await parallel(items.map(item => () => agent('...', { label: '...' })))`, never `await parallel(items.map(item => agent(...)))`. Results are returned in input order.",
    )
    expect(await WorkflowTool.prompt({} as never)).toContain(
      "Run a deterministic JavaScript workflow. Required script header: export const meta = { name: 'short_snake_case', description: 'non-empty description' }. Use phase(title) at runtime to create progress groups.",
    )
  })
})

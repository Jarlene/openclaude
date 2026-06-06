import { z } from 'zod/v4'
import type { AssistantMessage } from '../../types/message.js'
import type {
  ToolResult,
  ToolUseContext,
  ToolInputJSONSchema,
  ToolCallProgress,
} from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  createWorkflowSnapshot,
  preview,
  recomputeWorkflowSnapshot,
  renderWorkflowText,
  type WorkflowSnapshot,
} from './display.js'
import {
  completeWorkflowTask,
  failWorkflowTask,
  registerWorkflowTask,
  stopWorkflowTask,
  updateWorkflowTaskSnapshot,
} from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import { WORKFLOW_TOOL_NAME } from './constants.js'
import {
  parseWorkflowScript,
  runWorkflow,
  type WorkflowRunResult,
} from './workflow.js'
import { WorkflowAgent } from './agent.js'

export type WorkflowProgress = {
  type: 'workflow_progress'
  snapshot: WorkflowSnapshot
}

const inputSchema = lazySchema(() =>
  z.object({
    script: z.string(),
    args: z.unknown().optional(),
  }),
)

type InputSchema = ReturnType<typeof inputSchema>
export type Input = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    content: z.string(),
    details: z.unknown(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

export const WORKFLOW_PROMPT_GUIDELINES = [
  'Use workflow only when the user explicitly asks for a workflow, workflows, fan-out, or multi-agent orchestration.',
  'For workflow, always pass one raw JavaScript string in the required script parameter; do not include Markdown fences or prose around the script.',
  "For workflow, the script's first statement must be `export const meta = { name: 'short_snake_case', description: 'non-empty human description', phases:[ list of phases] }`; meta.name and meta.description are required non-empty strings, and meta.phases is optional metadata for a stable upfront outline.",
  'For workflow, write plain JavaScript after the meta export. Do not use TypeScript syntax, imports, require(), fs, Date.now(), Math.random(), or new Date().',
  'For workflow, available globals are agent(prompt, opts), parallel(thunks), pipeline(items, ...stages), phase(title), log(message), args, cwd, process.cwd(), and budget. Every workflow must call agent() at least once; do not use workflow only to declare phases or return a static object.',
  'For workflow, call phase(title) when a new group of work starts. Phase names may be conditional or built in a loop; do not predeclare speculative phases just in case.',
  'For workflow, prefer it for decomposable work: repository inspection, independent research/checks, multi-perspective review, or fan-out/fan-in synthesis. Do not use it for a single quick file read/edit or when ordinary tools are enough.',
  "For workflow, parallel() takes functions, not promises: use `await parallel(items.map(item => () => agent('...', { label: '...', phase: '...' })))`, never `await parallel(items.map(item => agent(...)))`. Results are returned in input order.",
  'For workflow, pipeline(items, ...stages) runs each item through stages sequentially, while different items may run concurrently. Each stage receives (previousValue, originalItem, index).',
  "For workflow, every agent() call should include a unique short label option, 2-5 words, such as { label: 'repo inventory', phase: 'initialization' } or { label: 'source modules', phase: 'analysis' }; unique labels make live status and error reporting readable.",
  'For workflow, failed agent(), parallel(), or pipeline() branches return null and log the failure unless the workflow is aborted. Check for nulls before synthesizing conclusions.',
  'For workflow, include a final synthesis/assertion agent when combining multiple subagent results; return a compact JSON-serializable value with ok/verdict plus the important outputs.',
  'For workflow, if agent() needs machine-readable output, pass a plain JSON Schema via opts.schema; agent() will return the validated object. Use JSON Schema syntax, not TypeScript or TypeBox constructors.',
  'For workflow, do not assume the parent assistant has repository code context inside subagents; include enough task context and relevant paths in each agent prompt.',
]

const WORKFLOW_PROMPT_SNIPPET =
  "Run a deterministic JavaScript workflow. Required script header: export const meta = { name: 'short_snake_case', description: 'non-empty description' }. Use phase(title) at runtime to create progress groups."

const WORKFLOW_DESCRIPTION = [
  'Execute a deterministic JavaScript workflow that orchestrates multiple subagents with agent(), parallel(), and pipeline().',
  'script is required raw JavaScript. It must start with export const meta = { name, description } and must call agent() at least once; phases are optional metadata.',
].join(' ')

const WORKFLOW_SCRIPT_DESCRIPTION = [
  'Required raw JavaScript workflow script, with no Markdown fences.',
  "First statement: export const meta = { name: 'short_snake_case', description: 'non-empty description' }. meta.phases is optional documentation; live progress is driven by phase(title).",
  'Use phase(\'Name\'), agent(prompt, opts), parallel(arrayOfFunctions), pipeline(items, ...stages), log(message), args, and budget. The workflow must call agent() at least once.',
  'parallel() requires functions, not promises: await parallel(items.map(item => () => agent(...))).',
].join(' ')

export const WorkflowTool = buildTool({
  name: WORKFLOW_TOOL_NAME,
  aliases: ['workflow'],
  searchHint: 'run dynamic workflow subagents',
  maxResultSizeChars: 100_000,
  async description(): Promise<string> {
    return WORKFLOW_DESCRIPTION
  },
  async prompt(): Promise<string> {
    return [WORKFLOW_PROMPT_SNIPPET, ...WORKFLOW_PROMPT_GUIDELINES].join('\n')
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  inputJSONSchema: {
    type: 'object',
    properties: {
      script: {
        type: 'string',
        description: WORKFLOW_SCRIPT_DESCRIPTION,
      },
      args: {
        description:
          'Optional JSON value exposed to the workflow script as global `args`. args properties example:{\"label\":\"Optional label for the agent\", \"phase\":\"phase identifier\",\"schema\":\"Optional schema definition as a Record\" ,\"model\":\"Optional model identifier\", \"subagent_type\":\"Optional type of the agent\", \"isolation\": \"Optional isolation mode, currently only \'worktree\' is supported\"}.',
      },
    },
    required: ['script'],
    additionalProperties: false,
  } satisfies ToolInputJSONSchema,
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return true
  },
  isOpenWorld() {
    return false
  },
  interruptBehavior() {
    return 'cancel'
  },
  async call(
    input: Input,
    toolUseContext: ToolUseContext,
    canUseTool: CanUseToolFn,
    assistantMessage: AssistantMessage,
    onProgress?: ToolCallProgress<any>,
  ): Promise<ToolResult<Output>> {
    const script = normalizeWorkflowScript(input.script)
    const parsed = parseWorkflowScript(script)
    let snapshot: WorkflowSnapshot = createWorkflowSnapshot(parsed.meta)
    const setTaskState =
      toolUseContext.setAppStateForTasks ?? toolUseContext.setAppState
    let progressCounter = 0
    const workflowTask = registerWorkflowTask({
      description: parsed.meta.description,
      snapshot,
      setAppState: setTaskState,
      abortController: toolUseContext.abortController,
      toolUseId: toolUseContext.toolUseId,
    })

    const update = () => {
      snapshot = recomputeWorkflowSnapshot(snapshot)
      updateWorkflowTaskSnapshot(workflowTask.id, snapshot, setTaskState)
      const progress: WorkflowProgress = { type: 'workflow_progress', snapshot }
      onProgress?.({
        toolUseID: `workflow-progress-${progressCounter++}`,
        data: progress,
      })
    }

    const recordPhase = (title: string | undefined) => {
      if (!title) return
      if (!snapshot.phases.includes(title)) snapshot.phases.push(title)
    }

    let result: WorkflowRunResult
    try {
      result = await runWorkflow(script, {
        cwd: process.cwd(),
        args: input.args,
        signal: toolUseContext.abortController.signal,
        agent: new WorkflowAgent({
          toolUseContext,
          canUseTool,
          assistantMessage,
        }),
        onLog(message) {
          snapshot.logs.push(message)
          update()
        },
        onPhase(title) {
          snapshot.currentPhase = title
          recordPhase(title)
          update()
        },
        onAgentStart(event) {
          recordPhase(event.phase)
          snapshot.agents.push({
            id: snapshot.agents.length + 1,
            label: event.label,
            phase: event.phase,
            prompt: event.prompt,
            status: 'running',
          })
          update()
        },
        onAgentEnd(event) {
          const agent = [...snapshot.agents]
            .reverse()
            .find(item => item.label === event.label && item.status === 'running')
          if (agent) {
            agent.status = event.result === null ? 'error' : 'done'
            agent.resultPreview = preview(event.result)
          }
          update()
        },
      })
    } catch (error) {
      if (toolUseContext.abortController.signal.aborted || isAbortError(error)) {
        for (const agent of snapshot.agents) {
          if (agent.status === 'running') {
            agent.status = 'skipped'
            agent.error = 'aborted'
          }
        }
        stopWorkflowTask(workflowTask.id, snapshot, setTaskState)
        throw new Error('Workflow was aborted')
      }
      failWorkflowTask(
        workflowTask.id,
        snapshot,
        error instanceof Error ? error.message : String(error),
        setTaskState,
      )
      throw error
    }

    if (result.agentCount === 0) {
      throw new Error(
        'workflow scripts must call agent() at least once; this workflow declared phases but did not run any subagents',
      )
    }

    snapshot.result = result.result
    snapshot.durationMs = result.durationMs
    snapshot = recomputeWorkflowSnapshot(snapshot)
    completeWorkflowTask(workflowTask.id, snapshot, setTaskState)

    const content = `Workflow ${result.meta.name} completed with ${result.agentCount} agent(s).\n\nResult:\n${JSON.stringify(result.result, null, 2)}`
    return {
      data: {
        content,
        details: {
          ...snapshot,
          meta: result.meta,
          phases: result.phases,
          logs: result.logs,
          result: result.result,
          durationMs: result.durationMs,
        },
      },
    }
  },
  renderToolUseMessage(input: Partial<Input>) {
    const script = typeof input.script === 'string' ? input.script : ''
    const name = safeWorkflowName(script)
    return name ? `workflow: ${name}` : 'workflow'
  },
  renderToolResultMessage(output: Output) {
    const details = output.details as WorkflowSnapshot | undefined
    if (details?.name) return renderWorkflowText(details, true)
    return output.content
  },
  renderToolUseProgressMessage(progressMessages) {
    const latest = progressMessages.findLast(
      message => message.data?.type === 'workflow_progress',
    )
    return latest?.data?.type === 'workflow_progress'
      ? renderWorkflowText(latest.data.snapshot, false)
      : null
  },
  renderToolUseRejectedMessage() {
    return 'Workflow rejected'
  },
  renderToolUseErrorMessage(result) {
    return typeof result === 'string' ? result : 'Workflow error'
  },
  mapToolResultToToolResultBlockParam(output: Output, toolUseID: string) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: output.content,
    }
  },
} satisfies ToolDef<InputSchema, Output>)

function normalizeWorkflowScript(script: string): string {
  let text = script.trim()
  const fence = text.match(/^```(?:js|javascript)?\s*\n([\s\S]*?)\n```$/i)
  if (fence) text = fence[1].trim()
  return text
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /\babort(?:ed)?\b/i.test(error.message)
}

function safeWorkflowName(script: string): string | null {
  try {
    return parseWorkflowScript(normalizeWorkflowScript(script)).meta.name
  } catch {
    return null
  }
}

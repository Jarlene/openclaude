import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { AssistantMessage, Message } from '../../types/message.js'
import type { ToolUseContext } from '../../Tool.js'
import { createUserMessage, extractTextContent } from '../../utils/messages.js'
import { createSyntheticOutputTool } from '../SyntheticOutputTool/SyntheticOutputTool.js'
import { runAgent } from '../AgentTool/runAgent.js'
import type { AgentDefinition } from '../AgentTool/loadAgentsDir.js'
import type { AgentOptions } from './workflow.js'

export interface WorkflowAgentOptions {
  toolUseContext: ToolUseContext
  canUseTool: CanUseToolFn
  assistantMessage: AssistantMessage
  cwd?: string
}

export class WorkflowAgent {
  private readonly toolUseContext: ToolUseContext
  private readonly canUseTool: CanUseToolFn
  private readonly assistantMessage: AssistantMessage

  constructor(options: WorkflowAgentOptions) {
    this.toolUseContext = options.toolUseContext
    this.canUseTool = options.canUseTool
    this.assistantMessage = options.assistantMessage
  }

  async run(
    prompt: string,
    options: AgentOptions & { signal?: AbortSignal; instructions?: string } = {},
  ): Promise<unknown> {
    const messages: Message[] = []
    const structured: { called: boolean; value: unknown } = {
      called: false,
      value: undefined,
    }
    const extraTools = []
    const toolUseContext = this.toolUseContext
    const canUseTool = this.canUseTool
    const assistantMessage = this.assistantMessage

    if (options.schema) {
      const result = createSyntheticOutputTool(options.schema)
      if ('error' in result) {
        throw new Error(`Invalid workflow agent schema: ${result.error}`)
      }
      extraTools.push({
        ...result.tool,
        async call(input: Record<string, unknown>) {
          const out = await result.tool.call(
            input,
            toolUseContext,
            canUseTool,
            assistantMessage,
          )
          structured.called = true
          structured.value = extractStructuredOutput(out.data, input)
          return out
        },
      })
    }

    const agentDefinition = this.resolveAgent(options.agentType)
    const availableTools = [...this.toolUseContext.options.tools, ...extraTools]
    const abortController = new AbortController()
    const abort = () => abortController.abort()
    if (options.signal?.aborted) abort()
    options.signal?.addEventListener('abort', abort, { once: true })

    try {
      for await (const message of runAgent({
        agentDefinition,
        promptMessages: [
          createUserMessage({
            content: this.buildPrompt(prompt, options, Boolean(options.schema)),
          }),
        ],
        toolUseContext: this.toolUseContext,
        canUseTool: this.canUseTool,
        isAsync: false,
        canShowPermissionPrompts: true,
        querySource: 'agent:workflow' as never,
        override: { abortController },
        model: options.model,
        availableTools,
        useExactTools: false,
        transcriptSubdir: 'workflows',
        description: options.label ?? agentDefinition.whenToUse,
      })) {
        messages.push(message)
      }
    } finally {
      options.signal?.removeEventListener('abort', abort)
    }

    if (options.schema) {
      if (!structured.called) {
        throw new Error('Subagent finished without calling structured_output')
      }
      return structured.value
    }

    return lastAssistantText(messages)
  }

  private resolveAgent(agentType: string | undefined): AgentDefinition {
    const agents = this.toolUseContext.options.agentDefinitions.activeAgents
    const fallback =
      agents.find(agent => agent.agentType === 'general-purpose') ?? agents[0]
    if (agentType) {
      const selected = agents.find(agent => agent.agentType === agentType)
      if (selected) return selected
    }
    if (!fallback) {
      throw new Error('No subagent definitions are available for workflow')
    }
    return fallback
  }

  private buildPrompt(
    prompt: string,
    options: AgentOptions & { instructions?: string },
    structured: boolean,
  ): string {
    const parts = [
      options.instructions,
      options.label ? `Task label: ${options.label}` : undefined,
      prompt,
    ].filter(Boolean)

    if (structured) {
      parts.push(
        [
          'Final output contract:',
          '- Your final action MUST be a structured_output tool call.',
          '- The structured_output arguments are the return value of this subagent.',
          '- Do not emit a prose final answer instead of structured_output.',
          '- If you need to inspect files or run commands first, do so, then call structured_output exactly once.',
        ].join('\n'),
      )
    }

    return parts.join('\n\n')
  }
}

function lastAssistantText(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.type !== 'assistant') continue
    const text = extractTextContent(message.message.content, '')
    if (text.trim()) return text
  }
  return ''
}

function extractStructuredOutput(data: unknown, fallback: unknown): unknown {
  if (data && typeof data === 'object' && 'structured_output' in data) {
    return (data as { structured_output: unknown }).structured_output
  }
  return fallback
}

import type { Command } from '../../types/command.js'

const workflows: Command = {
  type: 'prompt',
  name: 'workflows',
  description: 'Show dynamic workflow guidance',
  contentLength: 0,
  progressMessage: 'Loading workflows...',
  source: 'builtin',
  getPromptForCommand: async () => [
    {
      type: 'text',
      text: 'Use the workflow tool for dynamic JavaScript workflows. It runs deterministic scripts that orchestrate subagents with agent(), parallel(), pipeline(), phase(), and log().',
    },
  ],
}

export default workflows

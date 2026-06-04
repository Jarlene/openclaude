import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { getWorkflowCommands } from './createWorkflowCommand.js'
import { loadMarkdownFilesForSubdir } from '../../utils/markdownConfigLoader.js'

let tempDir: string | undefined

afterEach(async () => {
  loadMarkdownFilesForSubdir.cache?.clear?.()
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = undefined
  }
})

describe('getWorkflowCommands', () => {
  test('loads markdown workflow files as slash commands', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openclaude-workflows-'))
    const workflowDir = join(tempDir, '.claude', 'workflows')
    await mkdir(workflowDir, { recursive: true })
    await writeFile(
      join(workflowDir, 'inspect.md'),
      `---
description: Inspect repository modules
argument-hint: "[scope]"
arguments: scope
---
export const meta = {
  name: 'inspect_repo',
  description: 'Inspect repository modules',
}

phase('Scan')
const summary = await agent('Inspect $scope', { label: 'repo scan' })
return { summary }
`,
    )

    const commands = await getWorkflowCommands(tempDir)
    expect(commands).toHaveLength(1)
    const command = commands[0]!
    expect(command.name).toBe('inspect')
    expect(command.kind).toBe('workflow')
    expect(command.description).toBe('Inspect repository modules')
    expect(command.argumentHint).toBe('[scope]')
    expect(command.argNames).toEqual(['scope'])
    expect(command.allowedTools).toContain('workflow')

    const prompt = await command.getPromptForCommand('src', {} as never)
    expect(prompt).toHaveLength(1)
    expect(prompt[0]).toMatchObject({ type: 'text' })
    const text = 'text' in prompt[0] ? prompt[0].text : ''
    expect(text).toContain('Use the workflow tool to execute this workflow.')
    expect(text).toContain("export const meta = {\n  name: 'inspect_repo'")
    expect(text).toContain("agent('Inspect src', { label: 'repo scan' })")
  })
})

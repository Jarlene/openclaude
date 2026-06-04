import { basename, dirname, sep as pathSep } from 'path'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type { Command } from '../../types/command.js'
import {
  parseArgumentNames,
  substituteArguments,
} from '../../utils/argumentSubstitution.js'
import { logError } from '../../utils/log.js'
import {
  coerceDescriptionToString,
  parseBooleanFrontmatter,
} from '../../utils/frontmatterParser.js'
import {
  extractDescriptionFromMarkdown,
  loadMarkdownFilesForSubdir,
  parseSlashCommandToolsFromFrontmatter,
  type MarkdownFile,
} from '../../utils/markdownConfigLoader.js'
import { parseUserSpecifiedModel } from '../../utils/model/model.js'
import { WORKFLOW_TOOL_NAME } from './constants.js'

export async function getWorkflowCommands(cwd: string): Promise<Command[]> {
  try {
    const files = await loadMarkdownFilesForSubdir('workflows', cwd)
    const commands: Command[] = []

    for (const file of files) {
      try {
        commands.push(createWorkflowCommand(file))
      } catch (error) {
        logError(error)
      }
    }

    return commands
  } catch (error) {
    logError(error)
    return []
  }
}

function createWorkflowCommand(file: MarkdownFile): Command {
  const commandName = getWorkflowCommandName(file.filePath, file.baseDir)
  const validatedDescription = coerceDescriptionToString(
    file.frontmatter.description,
    commandName,
  )
  const description =
    validatedDescription ??
    extractDescriptionFromMarkdown(file.content, 'Dynamic workflow')
  const argumentNames = parseArgumentNames(
    file.frontmatter.arguments as string | string[] | undefined,
  )
  const userInvocable =
    file.frontmatter['user-invocable'] === undefined
      ? true
      : parseBooleanFrontmatter(file.frontmatter['user-invocable'])
  const model =
    file.frontmatter.model === 'inherit'
      ? undefined
      : file.frontmatter.model
        ? parseUserSpecifiedModel(String(file.frontmatter.model))
        : undefined

  return {
    type: 'prompt',
    name: commandName,
    description,
    hasUserSpecifiedDescription: validatedDescription !== null,
    allowedTools: [
      WORKFLOW_TOOL_NAME,
      ...parseSlashCommandToolsFromFrontmatter(file.frontmatter['allowed-tools']),
    ],
    argumentHint:
      file.frontmatter['argument-hint'] != null
        ? String(file.frontmatter['argument-hint'])
        : undefined,
    argNames: argumentNames.length > 0 ? argumentNames : undefined,
    whenToUse: file.frontmatter.when_to_use as string | undefined,
    version: file.frontmatter.version as string | undefined,
    model,
    disableModelInvocation: parseBooleanFrontmatter(
      file.frontmatter['disable-model-invocation'],
    ),
    userInvocable,
    contentLength: file.content.length,
    isHidden: !userInvocable,
    progressMessage: 'running workflow',
    source: file.source,
    loadedFrom: 'skills',
    kind: 'workflow',
    userFacingName() {
      return commandName
    },
    async getPromptForCommand(args): Promise<ContentBlockParam[]> {
      const workflowContent = substituteArguments(
        file.content,
        args,
        true,
        argumentNames,
      )

      return [
        {
          type: 'text',
          text: buildWorkflowPrompt({
            commandName,
            filePath: file.filePath,
            workflowContent,
            args,
          }),
        },
      ]
    },
  }
}

function buildWorkflowPrompt({
  commandName,
  filePath,
  workflowContent,
  args,
}: {
  commandName: string
  filePath: string
  workflowContent: string
  args: string | undefined
}): string {
  return [
    `Run the dynamic workflow command /${commandName}.`,
    `Workflow definition file: ${filePath}`,
    args ? `User arguments: ${args}` : undefined,
    '',
    'Use the workflow tool to execute this workflow. If the definition below is already a raw JavaScript workflow script, pass it as the workflow tool script unchanged except for argument substitution that has already been applied. If it is a natural-language workflow description or template, first write the required raw JavaScript workflow script, then call the workflow tool.',
    '',
    'Workflow definition:',
    '```',
    workflowContent,
    '```',
  ]
    .filter(part => part !== undefined)
    .join('\n')
}

function getWorkflowCommandName(filePath: string, baseDir: string): string {
  const fileName = basename(filePath)
  const commandBaseName = fileName.replace(/\.md$/i, '')
  const namespace = buildNamespace(dirname(filePath), baseDir)
  return namespace ? `${namespace}:${commandBaseName}` : commandBaseName
}

function buildNamespace(targetDir: string, baseDir: string): string {
  const normalizedBaseDir = baseDir.endsWith(pathSep)
    ? baseDir.slice(0, -1)
    : baseDir

  if (targetDir === normalizedBaseDir) {
    return ''
  }

  const relativePath = targetDir.slice(normalizedBaseDir.length + 1)
  return relativePath ? relativePath.split(pathSep).join(':') : ''
}

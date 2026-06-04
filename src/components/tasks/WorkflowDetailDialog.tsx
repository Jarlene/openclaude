import * as React from 'react'
import { Box, Text } from '../../ink.js'

export function WorkflowDetailDialog({
  onBack,
}: {
  taskId?: string
  onBack?: () => void
}): React.ReactNode {
  return (
    <Box flexDirection="column">
      <Text bold>Workflow</Text>
      <Text dimColor>Workflow task details are not available for inline runs.</Text>
      {onBack ? <Text dimColor>Press Esc to go back.</Text> : null}
    </Box>
  )
}

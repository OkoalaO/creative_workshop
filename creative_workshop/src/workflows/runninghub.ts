import type { ProviderCapability } from '../providers'

export type RunningHubWorkflowCapability = Extract<
  ProviderCapability,
  'text-to-image' | 'image-to-image' | 'image-to-video'
>

export type RunningHubNodeBinding = {
  nodeId: string
  fieldName: string
}

export type RunningHubWorkflow = {
  id: string
  name: string
  capability: RunningHubWorkflowCapability
  workflowId: string
  promptNode: RunningHubNodeBinding
  imageNode?: RunningHubNodeBinding
  enabled: boolean
  builtIn?: boolean
}

export const RUNNINGHUB_WORKFLOWS_KEY = 'cw-runninghub-workflows'
export const ACTIVE_RUNNINGHUB_WORKFLOW_KEY = 'cw-active-runninghub-workflow'

export const builtInRunningHubWorkflows: RunningHubWorkflow[] = [
  {
    id: 'runninghub-text-to-image',
    name: '默认文生图',
    capability: 'text-to-image',
    workflowId: '1997246493079834625',
    promptNode: { nodeId: '6', fieldName: 'text' },
    enabled: true,
    builtIn: true,
  },
  {
    id: 'runninghub-image-to-image',
    name: 'Qwen 图像编辑',
    capability: 'image-to-image',
    workflowId: '2004148282525949953',
    promptNode: { nodeId: '223', fieldName: 'value' },
    imageNode: { nodeId: '107', fieldName: 'image' },
    enabled: true,
    builtIn: true,
  },
  {
    id: 'runninghub-image-to-video',
    name: 'LTX 2.3 图生视频',
    capability: 'image-to-video',
    workflowId: '2073634201202679809',
    promptNode: { nodeId: '200', fieldName: 'prompt' },
    imageNode: { nodeId: '98', fieldName: 'image' },
    enabled: true,
    builtIn: true,
  },
]

export function createWorkflowDraft(): RunningHubWorkflow {
  return {
    id: crypto.randomUUID(),
    name: '',
    capability: 'text-to-image',
    workflowId: '',
    promptNode: { nodeId: '', fieldName: 'text' },
    enabled: true,
  }
}

export function readRunningHubWorkflows(rawValue: string | null): RunningHubWorkflow[] {
  if (!rawValue) return cloneBuiltInWorkflows()

  try {
    const parsed = JSON.parse(rawValue) as unknown
    if (!Array.isArray(parsed)) return cloneBuiltInWorkflows()
    if (parsed.length === 0) return []

    const workflows = parsed.flatMap((value) => {
      const workflow = normalizeWorkflow(value)
      return workflow ? [workflow] : []
    })

    return workflows.length ? workflows : cloneBuiltInWorkflows()
  } catch {
    return cloneBuiltInWorkflows()
  }
}

export function upsertRunningHubWorkflow(
  workflows: RunningHubWorkflow[],
  nextWorkflow: RunningHubWorkflow,
): RunningHubWorkflow[] {
  const normalized = normalizeWorkflow(nextWorkflow)
  if (!normalized) {
    throw new Error('请完整填写工作流名称、Workflow ID 和节点参数。')
  }

  const existingIndex = workflows.findIndex((workflow) => workflow.id === normalized.id)
  if (existingIndex < 0) return [...workflows, normalized]

  return workflows.map((workflow, index) => (index === existingIndex ? normalized : workflow))
}

export function removeRunningHubWorkflow(workflows: RunningHubWorkflow[], workflowId: string) {
  return workflows.filter((workflow) => workflow.id !== workflowId)
}

export function getAvailableRunningHubWorkflows(workflows: RunningHubWorkflow[]) {
  return workflows.filter((workflow) => workflow.enabled)
}

export function getWorkflowOrFallback(workflows: RunningHubWorkflow[], selectedId: string) {
  const available = getAvailableRunningHubWorkflows(workflows)
  return available.find((workflow) => workflow.id === selectedId) ?? available[0] ?? null
}

export function validateRunningHubWorkflow(workflow: RunningHubWorkflow) {
  if (!workflow.name.trim()) return '请填写工作流名称。'
  if (!/^\d+$/.test(workflow.workflowId.trim())) return 'Workflow ID 应为数字。'
  if (!workflow.promptNode.nodeId.trim() || !workflow.promptNode.fieldName.trim()) {
    return '请填写提示词节点 ID 和字段名。'
  }
  if (
    workflow.capability !== 'text-to-image' &&
    (!workflow.imageNode?.nodeId.trim() || !workflow.imageNode.fieldName.trim())
  ) {
    return '图像工作流需要填写参考图节点 ID 和字段名。'
  }
  return ''
}

export function cloneBuiltInWorkflows() {
  return builtInRunningHubWorkflows.map((workflow) => ({
    ...workflow,
    promptNode: { ...workflow.promptNode },
    imageNode: workflow.imageNode ? { ...workflow.imageNode } : undefined,
  }))
}

export function getBuiltInWorkflowForCapability(capability: RunningHubWorkflowCapability) {
  return builtInRunningHubWorkflows.find((workflow) => workflow.capability === capability)
}

export function migrateLegacyRunningHubWorkflow(value: unknown): RunningHubWorkflow | null {
  if (!value || typeof value !== 'object') return null
  const legacy = value as { workflowId?: unknown; nodeTemplate?: unknown }
  const workflowId = String(legacy.workflowId ?? '').trim()
  if (!workflowId || typeof legacy.nodeTemplate !== 'string') return null

  try {
    const nodes = JSON.parse(legacy.nodeTemplate) as Array<{
      nodeId?: unknown
      fieldName?: unknown
      fieldValue?: unknown
    }>
    const promptNode = nodes.find((node) => node.fieldValue === '{{prompt}}')
    if (!promptNode) return null

    const migrated: RunningHubWorkflow = {
      id: 'runninghub-legacy-custom',
      name: '迁移的文生图工作流',
      capability: 'text-to-image',
      workflowId,
      promptNode: {
        nodeId: String(promptNode.nodeId ?? '').trim(),
        fieldName: String(promptNode.fieldName ?? '').trim(),
      },
      enabled: true,
    }
    if (validateRunningHubWorkflow(migrated)) return null

    const builtIn = builtInRunningHubWorkflows[0]
    const matchesBuiltIn =
      migrated.workflowId === builtIn.workflowId &&
      migrated.promptNode.nodeId === builtIn.promptNode.nodeId &&
      migrated.promptNode.fieldName === builtIn.promptNode.fieldName
    return matchesBuiltIn ? null : migrated
  } catch {
    return null
  }
}

function normalizeWorkflow(value: unknown): RunningHubWorkflow | null {
  if (!value || typeof value !== 'object') return null

  const workflow = value as Partial<RunningHubWorkflow>
  const capability = workflow.capability
  if (
    capability !== 'text-to-image' &&
    capability !== 'image-to-image' &&
    capability !== 'image-to-video'
  ) {
    return null
  }

  const normalized: RunningHubWorkflow = {
    id: String(workflow.id ?? '').trim(),
    name: String(workflow.name ?? '').trim(),
    capability,
    workflowId: String(workflow.workflowId ?? '').trim(),
    promptNode: normalizeBinding(workflow.promptNode),
    imageNode: capability === 'text-to-image' ? undefined : normalizeBinding(workflow.imageNode),
    enabled: workflow.enabled !== false,
    builtIn: workflow.builtIn === true,
  }

  return normalized.id && !validateRunningHubWorkflow(normalized) ? normalized : null
}

function normalizeBinding(value: unknown): RunningHubNodeBinding {
  const binding = value && typeof value === 'object' ? (value as Partial<RunningHubNodeBinding>) : {}
  return {
    nodeId: String(binding.nodeId ?? '').trim(),
    fieldName: String(binding.fieldName ?? '').trim(),
  }
}

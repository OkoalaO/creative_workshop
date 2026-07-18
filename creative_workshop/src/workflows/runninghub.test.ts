import { describe, expect, it } from 'vitest'
import {
  builtInRunningHubWorkflows,
  migrateLegacyRunningHubWorkflow,
  getWorkflowOrFallback,
  readRunningHubWorkflows,
  removeRunningHubWorkflow,
  upsertRunningHubWorkflow,
  validateRunningHubWorkflow,
} from './runninghub'

describe('RunningHub workflow registry', () => {
  it('restores the three built-in workflows when storage is empty', () => {
    const workflows = readRunningHubWorkflows(null)

    expect(workflows).toHaveLength(3)
    expect(workflows.map((workflow) => workflow.capability)).toEqual([
      'text-to-image',
      'image-to-image',
      'image-to-video',
    ])
  })

  it('keeps an intentionally empty workflow list empty', () => {
    expect(readRunningHubWorkflows('[]')).toEqual([])
  })

  it('adds, edits, selects and removes a custom workflow', () => {
    const customWorkflow = {
      ...builtInRunningHubWorkflows[0],
      id: 'custom-product-photo',
      name: '产品摄影',
      workflowId: '123456789',
      builtIn: false,
    }
    const withCustom = upsertRunningHubWorkflow([], customWorkflow)
    const edited = upsertRunningHubWorkflow(withCustom, { ...customWorkflow, name: '产品摄影 Pro' })

    expect(edited[0].name).toBe('产品摄影 Pro')
    expect(getWorkflowOrFallback(edited, customWorkflow.id)?.id).toBe(customWorkflow.id)
    expect(removeRunningHubWorkflow(edited, customWorkflow.id)).toEqual([])
  })

  it('rejects an image workflow without an image node mapping', () => {
    const invalidWorkflow = {
      ...builtInRunningHubWorkflows[1],
      imageNode: undefined,
    }

    expect(validateRunningHubWorkflow(invalidWorkflow)).toContain('参考图节点')
  })

  it('falls back to the first enabled workflow', () => {
    const workflows = builtInRunningHubWorkflows.map((workflow, index) => ({
      ...workflow,
      enabled: index !== 0,
    }))

    expect(getWorkflowOrFallback(workflows, 'missing')?.id).toBe('runninghub-image-to-image')
  })

  it('migrates a legacy custom text-to-image workflow', () => {
    const migrated = migrateLegacyRunningHubWorkflow({
      workflowId: '99887766',
      nodeTemplate: JSON.stringify([
        { nodeId: '42', fieldName: 'prompt', fieldValue: '{{prompt}}' },
      ]),
    })

    expect(migrated).toMatchObject({
      workflowId: '99887766',
      promptNode: { nodeId: '42', fieldName: 'prompt' },
    })
  })
})

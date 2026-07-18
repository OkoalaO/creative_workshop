import {
  extractResultUrls,
  queryTask,
  type RunningHubResponse,
  type RunningHubSettings,
  submitWorkflowTask,
  uploadImage,
} from './runninghub'
import type { ProviderAdapter, ProviderTask } from './types'

export const runningHubAdapter: ProviderAdapter<RunningHubSettings> = {
  id: 'runninghub',
  name: 'RunningHub',
  execution: 'async',
  capabilities: ['text-to-image', 'image-to-image', 'image-to-video'],
  isConfigured: (settings) => Boolean(settings.apiKey.trim() && settings.workflow),
  uploadMedia: async (settings, file) => ({
    kind: 'url',
    url: await uploadImage(settings.apiKey, file),
    mimeType: file.type,
    name: file.name,
  }),
  submitTask: async (settings, request) => {
    const workflow = settings.workflow
    if (!workflow) throw new Error('请先选择 RunningHub 工作流。')
    if (workflow.capability !== request.capability) {
      throw new Error('当前工作流与本次创作类型不一致。')
    }

    const mediaUrl = request.media?.[0]?.url
    if (workflow.capability !== 'text-to-image' && !mediaUrl) {
      throw new Error('当前工作流需要参考图。')
    }

    return normalizeRunningHubTask(await submitWorkflowTask(settings, request.prompt, mediaUrl))
  },
  queryTask: async (settings, taskId) => normalizeRunningHubTask(await queryTask(settings.apiKey, taskId)),
  normalizeError: (error) => (error instanceof Error ? error : new Error('RunningHub 请求失败。')),
}

function normalizeRunningHubTask(response: RunningHubResponse): ProviderTask {
  return {
    taskId: response.taskId,
    status: response.status ?? 'RUNNING',
    outputs: extractResultUrls(response.results).map((url) => ({ type: 'image', url })),
    errorMessage: response.errorMessage,
    raw: response,
  }
}

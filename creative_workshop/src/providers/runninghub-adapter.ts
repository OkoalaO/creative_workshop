import {
  extractResultUrls,
  queryTask,
  type RunningHubResponse,
  type RunningHubSettings,
  submitImageToImageTask,
  submitImageToVideoTask,
  submitTextToImageTask,
  uploadImage,
} from './runninghub'
import type { ProviderAdapter, ProviderTask } from './types'

export const runningHubAdapter: ProviderAdapter<RunningHubSettings> = {
  id: 'runninghub',
  name: 'RunningHub',
  execution: 'async',
  capabilities: ['text-to-image', 'image-to-image', 'image-to-video'],
  isConfigured: (settings) => Boolean(settings.apiKey.trim()),
  uploadMedia: async (settings, file) => ({
    kind: 'url',
    url: await uploadImage(settings.apiKey, file),
    mimeType: file.type,
    name: file.name,
  }),
  submitTask: async (settings, request) => {
    const mediaUrl = request.media?.[0]?.url
    let response

    if (request.capability === 'image-to-video') {
      if (!mediaUrl) throw new Error('图生视频缺少参考图。')
      response = await submitImageToVideoTask(settings, request.prompt, mediaUrl)
    } else if (request.capability === 'image-to-image') {
      if (!mediaUrl) throw new Error('图生图缺少参考图。')
      response = await submitImageToImageTask(settings, request.prompt, mediaUrl)
    } else {
      response = await submitTextToImageTask(settings, request.prompt)
    }

    return normalizeRunningHubTask(response)
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

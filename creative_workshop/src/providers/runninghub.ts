import type { RunningHubWorkflow } from '../workflows/runninghub'

export type RunningHubStatus = 'IDLE' | 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED'

export type RunningHubResult = {
  url?: string
  fileUrl?: string
  nodeId?: string
  outputType?: string
  fileType?: string
  text?: string | null
}

export type RunningHubResponse = {
  code?: number
  msg?: string
  taskId?: string
  status?: RunningHubStatus
  errorCode?: string
  errorMessage?: string
  results?: RunningHubResult[] | null
  data?:
    | string
    | {
        taskId?: string | number
        taskStatus?: RunningHubStatus
        promptTips?: string
      }
    | RunningHubResult[]
    | null
}

export type RunningHubSettings = {
  apiKey: string
  workflow?: RunningHubWorkflow
  instanceType: 'default' | 'plus'
}

export type RunningHubUploadResponse = {
  code?: number
  msg?: string
  message?: string
  data?: {
    type?: string
    download_url?: string
    fileName?: string
    size?: string
  }
}

type RunWorkflowPayload = {
  addMetadata: boolean
  nodeInfoList: unknown
  instanceType: RunningHubSettings['instanceType']
  usePersonalQueue: 'false'
}

const RUNNINGHUB_BASE_URL = 'https://www.runninghub.cn/openapi/v2'
const RUNNINGHUB_PROXY_PREFIX = '/api/runninghub/openapi/v2'
export const defaultRunningHubSettings: RunningHubSettings = {
  apiKey: '',
  instanceType: 'default',
}

export function buildWorkflowPayload(
  settings: RunningHubSettings,
  prompt: string,
  imageUrl?: string,
): RunWorkflowPayload {
  const workflow = requireWorkflow(settings)
  const nodeInfoList = [
    {
      nodeId: workflow.promptNode.nodeId,
      fieldName: workflow.promptNode.fieldName,
      fieldValue: prompt.trim(),
    },
  ]

  if (workflow.capability !== 'text-to-image') {
    if (!imageUrl?.trim() || !workflow.imageNode) {
      throw new Error('当前工作流需要参考图。')
    }
    nodeInfoList.unshift({
      nodeId: workflow.imageNode.nodeId,
      fieldName: workflow.imageNode.fieldName,
      fieldValue: imageUrl.trim(),
    })
  }

  return {
    addMetadata: true,
    nodeInfoList,
    instanceType: settings.instanceType,
    usePersonalQueue: 'false',
  }
}

export async function submitWorkflowTask(
  settings: RunningHubSettings,
  prompt: string,
  imageUrl?: string,
) {
  const workflow = requireWorkflow(settings)
  const response = await fetch(buildRunningHubUrl(`/run/workflow/${workflow.workflowId}`), {
    method: 'POST',
    headers: buildHeaders(settings.apiKey),
    body: JSON.stringify(buildWorkflowPayload(settings, prompt, imageUrl)),
  })

  return parseRunningHubResponse(response, '提交失败')
}

export async function uploadImage(apiKey: string, file: File) {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(buildRunningHubUrl('/media/upload/binary'), {
    method: 'POST',
    headers: buildAuthHeaders(apiKey),
    body: formData,
  })
  const data = (await response.json()) as RunningHubUploadResponse

  if (!response.ok || data.code) {
    throw new Error(data.message || data.msg || `上传失败，HTTP ${response.status}`)
  }

  const imageUrl = data.data?.download_url || data.data?.fileName
  if (!imageUrl) {
    throw new Error('图片已上传，但 RunningHub 没有返回可用链接。')
  }

  return imageUrl
}

export async function queryTask(apiKey: string, taskId: string | undefined): Promise<RunningHubResponse> {
  if (!taskId) {
    throw new Error('缺少 RunningHub 任务 ID，无法查询结果。')
  }

  const response = await fetch(buildRunningHubUrl('/query'), {
    method: 'POST',
    headers: buildHeaders(apiKey),
    body: JSON.stringify({ taskId }),
  })

  return parseRunningHubResponse(response, '查询失败')
}

export function extractResultUrls(results: RunningHubResult[] | null | undefined) {
  return (results ?? []).map((result) => result.url || result.fileUrl).filter((url): url is string => Boolean(url))
}

export function buildRunningHubUrl(path: string) {
  if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
    return `${RUNNINGHUB_PROXY_PREFIX}${path}`
  }

  return `${RUNNINGHUB_BASE_URL}${path}`
}

function buildHeaders(apiKey: string) {
  return {
    'Content-Type': 'application/json',
    ...buildAuthHeaders(apiKey),
  }
}

function buildAuthHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey.trim()}`,
  }
}

async function parseRunningHubResponse(response: Response, fallbackMessage: string) {
  const data = (await response.json()) as RunningHubResponse

  if (!response.ok || data.errorCode || data.code) {
    throw new Error(data.errorMessage || data.msg || `${fallbackMessage}，HTTP ${response.status}`)
  }

  if (data.data && !Array.isArray(data.data) && typeof data.data === 'object') {
    const taskId = data.data.taskId ? String(data.data.taskId) : data.taskId
    return { ...data, taskId, status: data.data.taskStatus ?? data.status }
  }

  return data
}

function requireWorkflow(settings: RunningHubSettings) {
  if (!settings.workflow) {
    throw new Error('请先选择 RunningHub 工作流。')
  }
  return settings.workflow
}

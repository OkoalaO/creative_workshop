export type RunningHubStatus = 'IDLE' | 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED'

export type RunningHubResult = {
  url?: string
  nodeId?: string
  outputType?: string
  text?: string | null
}

export type RunningHubResponse = {
  taskId?: string
  status?: RunningHubStatus
  errorCode?: string
  errorMessage?: string
  results?: RunningHubResult[] | null
}

export type RunningHubSettings = {
  apiKey: string
  workflowId: string
  instanceType: 'default' | 'plus'
  nodeTemplate: string
}

export type RunningHubUploadResponse = {
  code?: number
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
const IMAGE_TO_IMAGE_WORKFLOW_ID = '2004148282525949953'
const IMAGE_TO_VIDEO_WORKFLOW_ID = '2073634201202679809'
const IMAGE_TO_IMAGE_NODE_TEMPLATE =
  '[\n  {\n    "nodeId": "107",\n    "fieldName": "image",\n    "fieldValue": "{{imageUrl}}"\n  },\n  {\n    "nodeId": "223",\n    "fieldName": "value",\n    "fieldValue": "{{prompt}}"\n  }\n]'
const IMAGE_TO_VIDEO_NODE_TEMPLATE =
  '[\n  {\n    "nodeId": "98",\n    "fieldName": "image",\n    "fieldValue": "{{imageUrl}}"\n  },\n  {\n    "nodeId": "200",\n    "fieldName": "prompt",\n    "fieldValue": "{{prompt}}"\n  }\n]'

export const defaultRunningHubSettings: RunningHubSettings = {
  apiKey: '',
  workflowId: '1997246493079834625',
  instanceType: 'default',
  nodeTemplate:
    '[\n  {\n    "nodeId": "6",\n    "fieldName": "text",\n    "fieldValue": "{{prompt}}"\n  }\n]',
}

export function buildTextToImagePayload(settings: RunningHubSettings, prompt: string): RunWorkflowPayload {
  return {
    addMetadata: true,
    nodeInfoList: buildNodeInfoList(settings.nodeTemplate, { prompt }),
    instanceType: settings.instanceType,
    usePersonalQueue: 'false',
  }
}

export function buildImageToImagePayload(
  settings: RunningHubSettings,
  prompt: string,
  imageUrl: string,
): RunWorkflowPayload {
  return {
    addMetadata: true,
    nodeInfoList: buildNodeInfoList(IMAGE_TO_IMAGE_NODE_TEMPLATE, { prompt, imageUrl }),
    instanceType: settings.instanceType,
    usePersonalQueue: 'false',
  }
}

export function buildImageToVideoPayload(
  settings: RunningHubSettings,
  prompt: string,
  imageUrl: string,
): RunWorkflowPayload {
  return {
    addMetadata: true,
    nodeInfoList: buildNodeInfoList(IMAGE_TO_VIDEO_NODE_TEMPLATE, { prompt, imageUrl }),
    instanceType: settings.instanceType,
    usePersonalQueue: 'false',
  }
}

export async function submitTextToImageTask(settings: RunningHubSettings, prompt: string) {
  const response = await fetch(`${RUNNINGHUB_BASE_URL}/run/workflow/${settings.workflowId}`, {
    method: 'POST',
    headers: buildHeaders(settings.apiKey),
    body: JSON.stringify(buildTextToImagePayload(settings, prompt)),
  })

  return parseRunningHubResponse(response, '提交失败')
}

export async function uploadImage(apiKey: string, file: File) {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(`${RUNNINGHUB_BASE_URL}/media/upload/binary`, {
    method: 'POST',
    headers: buildAuthHeaders(apiKey),
    body: formData,
  })
  const data = (await response.json()) as RunningHubUploadResponse

  if (!response.ok || data.code) {
    throw new Error(data.message || `上传失败，HTTP ${response.status}`)
  }

  const imageUrl = data.data?.download_url || data.data?.fileName
  if (!imageUrl) {
    throw new Error('图片已上传，但 RunningHub 没有返回可用链接。')
  }

  return imageUrl
}

export async function submitImageToImageTask(settings: RunningHubSettings, prompt: string, imageUrl: string) {
  const response = await fetch(`${RUNNINGHUB_BASE_URL}/run/workflow/${IMAGE_TO_IMAGE_WORKFLOW_ID}`, {
    method: 'POST',
    headers: buildHeaders(settings.apiKey),
    body: JSON.stringify(buildImageToImagePayload(settings, prompt, imageUrl)),
  })

  return parseRunningHubResponse(response, '提交图生图任务失败')
}

export async function submitImageToVideoTask(settings: RunningHubSettings, prompt: string, imageUrl: string) {
  const response = await fetch(`${RUNNINGHUB_BASE_URL}/run/workflow/${IMAGE_TO_VIDEO_WORKFLOW_ID}`, {
    method: 'POST',
    headers: buildHeaders(settings.apiKey),
    body: JSON.stringify(buildImageToVideoPayload(settings, prompt, imageUrl)),
  })

  return parseRunningHubResponse(response, '提交图生视频任务失败')
}

export async function queryTask(apiKey: string, taskId: string | undefined) {
  if (!taskId) {
    throw new Error('缺少 RunningHub 任务 ID，无法查询结果。')
  }

  const response = await fetch(`${RUNNINGHUB_BASE_URL}/query`, {
    method: 'POST',
    headers: buildHeaders(apiKey),
    body: JSON.stringify({ taskId }),
  })

  return parseRunningHubResponse(response, '查询失败')
}

export function extractResultUrls(results: RunningHubResult[] | null | undefined) {
  return (results ?? []).map((result) => result.url).filter((url): url is string => Boolean(url))
}

function buildNodeInfoList(nodeTemplate: string, values: Record<string, string>) {
  try {
    const parsedTemplate = JSON.parse(nodeTemplate) as unknown
    return replaceTemplateValues(parsedTemplate, values)
  } catch {
    throw new Error('内置节点模板不是有效 JSON，需要检查工作流参数映射。')
  }
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

function replaceTemplateValues(value: unknown, values: Record<string, string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => replaceTemplateValues(item, values))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [entryKey, replaceTemplateValues(entryValue, values)]),
    )
  }

  if (typeof value === 'string') {
    return Object.entries(values).reduce(
      (nextValue, [key, replacement]) => nextValue.replaceAll(`{{${key}}}`, replacement.trim()),
      value,
    )
  }

  return value
}

async function parseRunningHubResponse(response: Response, fallbackMessage: string) {
  const data = (await response.json()) as RunningHubResponse

  if (!response.ok || data.errorCode) {
    throw new Error(data.errorMessage || `${fallbackMessage}，HTTP ${response.status}`)
  }

  return data
}

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
  workflowId: string
  instanceType: 'default' | 'plus'
  nodeTemplate: string
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
  apiKey: string
  workflowId: string
  addMetadata: boolean
  nodeInfoList: unknown
  instanceType: RunningHubSettings['instanceType']
  usePersonalQueue: false
}

const RUNNINGHUB_BASE_URL = 'https://www.runninghub.ai'
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
    apiKey: settings.apiKey.trim(),
    workflowId: settings.workflowId,
    addMetadata: true,
    nodeInfoList: buildNodeInfoList(settings.nodeTemplate, { prompt }),
    instanceType: settings.instanceType,
    usePersonalQueue: false,
  }
}

export function buildImageToImagePayload(
  settings: RunningHubSettings,
  prompt: string,
  imageUrl: string,
): RunWorkflowPayload {
  return {
    apiKey: settings.apiKey.trim(),
    workflowId: IMAGE_TO_IMAGE_WORKFLOW_ID,
    addMetadata: true,
    nodeInfoList: buildNodeInfoList(IMAGE_TO_IMAGE_NODE_TEMPLATE, { prompt, imageUrl }),
    instanceType: settings.instanceType,
    usePersonalQueue: false,
  }
}

export function buildImageToVideoPayload(
  settings: RunningHubSettings,
  prompt: string,
  imageUrl: string,
): RunWorkflowPayload {
  return {
    apiKey: settings.apiKey.trim(),
    workflowId: IMAGE_TO_VIDEO_WORKFLOW_ID,
    addMetadata: true,
    nodeInfoList: buildNodeInfoList(IMAGE_TO_VIDEO_NODE_TEMPLATE, { prompt, imageUrl }),
    instanceType: settings.instanceType,
    usePersonalQueue: false,
  }
}

export async function submitTextToImageTask(settings: RunningHubSettings, prompt: string) {
  const response = await fetch(`${RUNNINGHUB_BASE_URL}/task/openapi/create`, {
    method: 'POST',
    headers: buildHeaders(settings.apiKey),
    body: JSON.stringify(buildTextToImagePayload(settings, prompt)),
  })

  return parseRunningHubResponse(response, '提交失败')
}

export async function uploadImage(apiKey: string, file: File) {
  const formData = new FormData()
  formData.append('apiKey', apiKey.trim())
  formData.append('file', file)
  formData.append('fileType', 'input')

  const response = await fetch(`${RUNNINGHUB_BASE_URL}/task/openapi/upload`, {
    method: 'POST',
    headers: buildAuthHeaders(apiKey),
    body: formData,
  })
  const data = (await response.json()) as RunningHubUploadResponse

  if (!response.ok || data.code) {
    throw new Error(data.message || data.msg || `上传失败，HTTP ${response.status}`)
  }

  const imageUrl = data.data?.fileName || data.data?.download_url
  if (!imageUrl) {
    throw new Error('图片已上传，但 RunningHub 没有返回 fileName。')
  }

  return imageUrl
}

export async function submitImageToImageTask(settings: RunningHubSettings, prompt: string, imageUrl: string) {
  const response = await fetch(`${RUNNINGHUB_BASE_URL}/task/openapi/create`, {
    method: 'POST',
    headers: buildHeaders(settings.apiKey),
    body: JSON.stringify(buildImageToImagePayload(settings, prompt, imageUrl)),
  })

  return parseRunningHubResponse(response, '提交图生图任务失败')
}

export async function submitImageToVideoTask(settings: RunningHubSettings, prompt: string, imageUrl: string) {
  const response = await fetch(`${RUNNINGHUB_BASE_URL}/task/openapi/create`, {
    method: 'POST',
    headers: buildHeaders(settings.apiKey),
    body: JSON.stringify(buildImageToVideoPayload(settings, prompt, imageUrl)),
  })

  return parseRunningHubResponse(response, '提交图生视频任务失败')
}

export async function queryTask(apiKey: string, taskId: string | undefined): Promise<RunningHubResponse> {
  if (!taskId) {
    throw new Error('缺少 RunningHub 任务 ID，无法查询结果。')
  }

  const statusResponse = await fetch(`${RUNNINGHUB_BASE_URL}/task/openapi/status`, {
    method: 'POST',
    headers: buildHeaders(apiKey),
    body: JSON.stringify({ apiKey: apiKey.trim(), taskId }),
  })
  const statusData = await parseRunningHubResponse(statusResponse, '查询任务状态失败')
  const status = normalizeTaskStatus(statusData.data) ?? statusData.status

  if (status && status !== 'SUCCESS') {
    return { ...statusData, taskId, status }
  }

  const outputsResponse = await fetch(`${RUNNINGHUB_BASE_URL}/task/openapi/outputs`, {
    method: 'POST',
    headers: buildHeaders(apiKey),
    body: JSON.stringify({ apiKey: apiKey.trim(), taskId }),
  })
  const outputsData = await parseRunningHubResponse(outputsResponse, '查询任务结果失败')
  const results = Array.isArray(outputsData.data) ? outputsData.data.map(normalizeResult) : []

  return { ...outputsData, taskId, status: results.length ? 'SUCCESS' : status ?? 'RUNNING', results }
}

export function extractResultUrls(results: RunningHubResult[] | null | undefined) {
  return (results ?? []).map((result) => result.url || result.fileUrl).filter((url): url is string => Boolean(url))
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

  if (!response.ok || data.errorCode || data.code) {
    throw new Error(data.errorMessage || data.msg || `${fallbackMessage}，HTTP ${response.status}`)
  }

  if (data.data && !Array.isArray(data.data) && typeof data.data === 'object') {
    const taskId = data.data.taskId ? String(data.data.taskId) : data.taskId
    return { ...data, taskId, status: data.data.taskStatus ?? data.status }
  }

  return data
}

function normalizeTaskStatus(data: RunningHubResponse['data']): RunningHubStatus | undefined {
  if (typeof data === 'string') {
    return isRunningHubStatus(data) ? data : undefined
  }

  if (data && !Array.isArray(data) && isRunningHubStatus(data.taskStatus)) {
    return data.taskStatus
  }

  return undefined
}

function normalizeResult(result: RunningHubResult): RunningHubResult {
  return {
    ...result,
    url: result.url || result.fileUrl,
    outputType: result.outputType || result.fileType,
  }
}

function isRunningHubStatus(value: unknown): value is RunningHubStatus {
  return value === 'IDLE' || value === 'QUEUED' || value === 'RUNNING' || value === 'SUCCESS' || value === 'FAILED'
}

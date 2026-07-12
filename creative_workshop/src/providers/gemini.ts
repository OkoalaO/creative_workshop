import type {
  ProviderAdapter,
  ProviderMedia,
  ProviderOutput,
  ProviderSubmitRequest,
  ProviderTask,
} from './types'

export type GeminiProtocol = 'google-interactions' | 'newapi-gemini' | 'openai-images'

export type GeminiSettings = {
  apiKey: string
  baseUrl: string
  modelId: string
  protocol: GeminiProtocol
  rememberApiKey: boolean
}

type ImageBlock = {
  type?: string
  data?: string
  mime_type?: string
  mimeType?: string
}

type ApiError = {
  error?: {
    code?: number | string
    message?: string
    status?: string
    type?: string
  }
}

type InteractionResponse = ApiError & {
  id?: string
  output_image?: ImageBlock
  outputImage?: ImageBlock
  steps?: Array<{
    content?: ImageBlock[]
  }>
}

type NativeGeminiResponse = ApiError & {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        inlineData?: ImageBlock
        inline_data?: ImageBlock
      }>
    }
  }>
}

type OpenAiImagesResponse = ApiError & {
  created?: number
  data?: Array<{
    url?: string
    b64_json?: string
    revised_prompt?: string
  }>
}

export const defaultGeminiSettings: GeminiSettings = {
  apiKey: '',
  baseUrl: 'https://generativelanguage.googleapis.com/v1',
  modelId: 'gemini-3.1-flash-image',
  protocol: 'google-interactions',
  rememberApiKey: false,
}

export const geminiAdapter: ProviderAdapter<GeminiSettings> = {
  id: 'gemini',
  name: 'NanoBanana',
  execution: 'sync',
  capabilities: ['text-to-image', 'image-to-image'],
  isConfigured: (settings) => Boolean(settings.apiKey.trim() && settings.baseUrl.trim() && settings.modelId.trim()),
  uploadMedia: async (_settings, file) => ({
    kind: 'inline',
    data: await fileToBase64(file),
    mimeType: file.type || 'image/png',
    name: file.name,
  }),
  submitTask: submitGeminiTask,
  normalizeError: normalizeGeminiError,
}

export async function submitGeminiTask(
  settings: GeminiSettings,
  request: ProviderSubmitRequest,
): Promise<ProviderTask> {
  validateSettings(settings)

  if (!geminiAdapter.capabilities.includes(request.capability)) {
    throw new Error('NanoBanana 当前仅支持文生图和图生图。')
  }

  if (settings.protocol === 'openai-images' && request.capability !== 'text-to-image') {
    throw new Error('OpenAI Images 生成协议暂不支持图生图，请改用 New API 原生 Gemini。')
  }

  if (settings.protocol === 'newapi-gemini') {
    return submitNewApiGeminiTask(settings, request)
  }

  if (settings.protocol === 'openai-images') {
    return submitOpenAiImagesTask(settings, request)
  }

  return submitInteractionTask(settings, request)
}

export function buildInteractionsUrl(baseUrl: string) {
  const normalizedUrl = normalizeBaseUrl(baseUrl)
  return normalizedUrl.endsWith('/interactions') ? normalizedUrl : `${normalizedUrl}/interactions`
}

export function buildNewApiGeminiUrl(baseUrl: string, modelId: string) {
  const normalizedUrl = normalizeBaseUrl(baseUrl)
  if (/:generateContent\/?$/i.test(normalizedUrl)) {
    return normalizedUrl
  }

  const apiRoot = normalizedUrl.replace(/\/(?:v1|v1beta)$/i, '')
  return `${apiRoot}/v1beta/models/${encodeURIComponent(modelId.trim())}:generateContent`
}

export function buildOpenAiImagesUrl(baseUrl: string) {
  const normalizedUrl = normalizeBaseUrl(baseUrl)
  if (/\/images\/generations\/?$/i.test(normalizedUrl)) {
    return normalizedUrl
  }

  return /\/v1$/i.test(normalizedUrl)
    ? `${normalizedUrl}/images/generations`
    : `${normalizedUrl}/v1/images/generations`
}

export function extractInteractionOutputs(data: InteractionResponse): ProviderOutput[] {
  const blocks: ImageBlock[] = []
  const outputImage = data.output_image ?? data.outputImage

  if (outputImage?.data) blocks.push(outputImage)
  for (const step of data.steps ?? []) {
    for (const block of step.content ?? []) {
      if (block.type === 'image' && block.data) blocks.push(block)
    }
  }

  return imageBlocksToOutputs(blocks)
}

export function extractNativeGeminiOutputs(data: NativeGeminiResponse): ProviderOutput[] {
  const blocks: ImageBlock[] = []
  for (const candidate of data.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const block = part.inlineData ?? part.inline_data
      if (block?.data) blocks.push(block)
    }
  }

  return imageBlocksToOutputs(blocks)
}

export function extractOpenAiImageOutputs(data: OpenAiImagesResponse): ProviderOutput[] {
  return (data.data ?? []).flatMap((item) => {
    if (item.url) return [{ type: 'image' as const, url: item.url }]
    if (item.b64_json) return [{ type: 'image' as const, url: `data:image/png;base64,${item.b64_json}` }]
    return []
  })
}

export function getGeminiProtocolDescription(protocol: GeminiProtocol) {
  if (protocol === 'newapi-gemini') return '使用 New API 原生 Gemini generateContent 协议。'
  if (protocol === 'openai-images') return '使用 OpenAI Images 兼容协议，仅支持文生图。'
  return '使用 Google Gemini Interactions API 及兼容接口。'
}

async function submitInteractionTask(settings: GeminiSettings, request: ProviderSubmitRequest): Promise<ProviderTask> {
  const data = await requestJson<InteractionResponse>(
    buildInteractionsUrl(settings.baseUrl),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': settings.apiKey.trim(),
      },
      body: JSON.stringify({
        model: settings.modelId.trim(),
        input: buildInteractionInput(request),
        response_format: { type: 'image', mime_type: 'image/png' },
      }),
    },
    settings.protocol,
  )

  return completedTask(data.id, extractInteractionOutputs(data), data)
}

async function submitNewApiGeminiTask(
  settings: GeminiSettings,
  request: ProviderSubmitRequest,
): Promise<ProviderTask> {
  const data = await requestJson<NativeGeminiResponse>(
    buildNewApiGeminiUrl(settings.baseUrl, settings.modelId),
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: request.prompt }, ...(request.media ?? []).map(toNativeGeminiMedia)],
          },
        ],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
        },
      }),
    },
    settings.protocol,
  )

  return completedTask(undefined, extractNativeGeminiOutputs(data), data)
}

async function submitOpenAiImagesTask(
  settings: GeminiSettings,
  request: ProviderSubmitRequest,
): Promise<ProviderTask> {
  const data = await requestJson<OpenAiImagesResponse>(
    buildOpenAiImagesUrl(settings.baseUrl),
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: settings.modelId.trim(),
        prompt: request.prompt,
        n: 1,
      }),
    },
    settings.protocol,
  )

  return completedTask(undefined, extractOpenAiImageOutputs(data), data)
}

function completedTask(taskId: string | undefined, outputs: ProviderOutput[], raw: unknown): ProviderTask {
  if (!outputs.length) {
    throw new Error('接口请求成功，但响应中没有可用的图片数据。请确认模型支持当前协议。')
  }

  return { taskId, status: 'SUCCESS', outputs, raw }
}

function buildInteractionInput(request: ProviderSubmitRequest) {
  return [{ type: 'text', text: request.prompt }, ...(request.media ?? []).map(toInteractionMedia)]
}

function toInteractionMedia(media: ProviderMedia) {
  ensureInlineMedia(media)
  return { type: 'image', data: media.data, mime_type: media.mimeType ?? 'image/png' }
}

function toNativeGeminiMedia(media: ProviderMedia) {
  ensureInlineMedia(media)
  return {
    inlineData: {
      data: media.data,
      mimeType: media.mimeType ?? 'image/png',
    },
  }
}

function ensureInlineMedia(media: ProviderMedia): asserts media is ProviderMedia & { data: string } {
  if (media.kind !== 'inline' || !media.data) {
    throw new Error('当前协议需要可读取的本地图片数据。')
  }
}

function validateSettings(settings: GeminiSettings) {
  if (!settings.apiKey.trim()) throw new Error('请先填写 API Key。')
  if (!settings.modelId.trim()) throw new Error('请填写模型 ID。')

  if (settings.protocol === 'newapi-gemini') {
    buildNewApiGeminiUrl(settings.baseUrl, settings.modelId)
  } else if (settings.protocol === 'openai-images') {
    buildOpenAiImagesUrl(settings.baseUrl)
  } else {
    buildInteractionsUrl(settings.baseUrl)
  }
}

function normalizeBaseUrl(baseUrl: string) {
  const trimmedUrl = baseUrl.trim().replace(/\/+$/, '')
  const parsedUrl = new URL(trimmedUrl)
  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    throw new Error('API Base URL 必须使用 http 或 https。')
  }
  return trimmedUrl
}

async function requestJson<T extends ApiError>(url: string, init: RequestInit, protocol: GeminiProtocol): Promise<T> {
  const response = await fetchWithProductionProxy(url, init)
  const responseText = await response.text()
  let data: T

  try {
    data = JSON.parse(responseText) as T
  } catch {
    const summary = responseText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180)
    throw new Error(
      `${getProtocolLabel(protocol)} 返回了非 JSON 响应（HTTP ${response.status}）${summary ? `：${summary}` : '。'}`,
    )
  }

  if (!response.ok || data.error) {
    throw createHttpError(response.status, data.error?.message, protocol)
  }

  return data
}

async function fetchWithProductionProxy(url: string, init: RequestInit) {
  if (!shouldUseProductionProxy(url)) return fetch(url, init)

  const target = new URL(url)
  if (target.host !== '38.145.218.40:12001') {
    throw new Error('该 HTTP API 地址暂未获得平台支持。')
  }

  return fetch(`/api/newapi${target.pathname}${target.search}`, init)
}

export function shouldUseProductionProxy(url: string) {
  if (typeof window === 'undefined' || window.location.protocol !== 'https:') return false
  return new URL(url).protocol === 'http:'
}

function createHttpError(status: number, detail: string | undefined, protocol: GeminiProtocol) {
  const prefix = getProtocolLabel(protocol)
  if (status === 401 || status === 403) return new Error(detail || `${prefix} 鉴权失败，请检查 API Key。`)
  if (status === 429) return new Error(detail || `${prefix} 请求过于频繁或额度不足。`)
  if (status === 400 || status === 404) {
    return new Error(detail || `${prefix} 拒绝了请求，请检查协议、模型 ID 和 API 地址。`)
  }
  return new Error(detail || `${prefix} 请求失败，HTTP ${status}。`)
}

function getProtocolLabel(protocol: GeminiProtocol) {
  if (protocol === 'newapi-gemini') return 'New API Gemini'
  if (protocol === 'openai-images') return 'OpenAI Images'
  return 'Gemini Interactions'
}

function imageBlocksToOutputs(blocks: ImageBlock[]): ProviderOutput[] {
  const seen = new Set<string>()
  return blocks.flatMap((block) => {
    if (!block.data || seen.has(block.data)) return []
    seen.add(block.data)
    const mimeType = block.mime_type ?? block.mimeType ?? 'image/png'
    return [{ type: 'image' as const, url: `data:${mimeType};base64,${block.data}`, mimeType }]
  })
}

function normalizeGeminiError(error: unknown) {
  if (error instanceof TypeError && error.message === 'Failed to fetch') {
    return new Error('无法连接接口。请检查网络、CORS、HTTPS 混合内容和 API 地址。')
  }
  return error instanceof Error ? error : new Error('生图失败，请稍后重试。')
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const commaIndex = result.indexOf(',')
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result)
    }
    reader.onerror = () => reject(new Error('参考图读取失败，请重新选择图片。'))
    reader.readAsDataURL(file)
  })
}

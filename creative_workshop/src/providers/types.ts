export type ProviderId = 'runninghub' | 'gemini'

export type ProviderCapability =
  | 'text-to-image'
  | 'image-to-image'
  | 'text-to-video'
  | 'image-to-video'
  | 'upscale'
  | 'remove-watermark'

export type ProviderTaskStatus = 'IDLE' | 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED'

export type ProviderMedia = {
  kind: 'url' | 'inline'
  url?: string
  data?: string
  mimeType?: string
  name?: string
}

export type ProviderOutput = {
  type: 'image' | 'video' | 'text'
  url?: string
  text?: string
  mimeType?: string
}

export type ProviderTask = {
  taskId?: string
  status: ProviderTaskStatus
  outputs: ProviderOutput[]
  errorMessage?: string
  raw?: unknown
}

export type ProviderSubmitRequest = {
  prompt: string
  capability: ProviderCapability
  media?: ProviderMedia[]
}

export type ProviderAdapter<TSettings> = {
  id: ProviderId
  name: string
  execution: 'sync' | 'async'
  capabilities: readonly ProviderCapability[]
  isConfigured: (settings: TSettings) => boolean
  submitTask: (settings: TSettings, request: ProviderSubmitRequest) => Promise<ProviderTask>
  queryTask?: (settings: TSettings, taskId: string) => Promise<ProviderTask>
  uploadMedia?: (settings: TSettings, file: File) => Promise<ProviderMedia>
  normalizeError: (error: unknown) => Error
}

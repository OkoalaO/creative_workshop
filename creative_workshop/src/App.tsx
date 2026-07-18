import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUp,
  Copy,
  Download,
  History,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Scan,
  Settings2,
  Trash2,
  X,
} from 'lucide-react'
import {
  defaultRunningHubSettings,
  type RunningHubSettings,
  type RunningHubStatus,
} from './providers/runninghub'
import {
  defaultGeminiSettings,
  geminiAdapter,
  getGeminiProtocolDescription,
  type GeminiSettings,
  type ProviderId,
  type ProviderTask,
  runningHubAdapter,
} from './providers'
import AuroraBackground from './components/AuroraBackground'
import { resolveGenerationMode, type GenerationMode } from './generation'
import { upsertHistoryItem } from './history'
import {
  ACTIVE_RUNNINGHUB_WORKFLOW_KEY,
  builtInRunningHubWorkflows,
  cloneBuiltInWorkflows,
  createWorkflowDraft,
  getAvailableRunningHubWorkflows,
  getBuiltInWorkflowForCapability,
  getWorkflowOrFallback,
  migrateLegacyRunningHubWorkflow,
  readRunningHubWorkflows,
  removeRunningHubWorkflow,
  RUNNINGHUB_WORKFLOWS_KEY,
  type RunningHubWorkflow,
  upsertRunningHubWorkflow,
  validateRunningHubWorkflow,
} from './workflows/runninghub'
import './App.css'

type GenerationStatus = RunningHubStatus | 'PENDING_RESULT'

type GenerationItem = {
  id: string
  title: string
  prompt: string
  providerId?: ProviderId
  mode?: GenerationMode
  workflow?: RunningHubWorkflow
  status: GenerationStatus
  taskId?: string
  resultUrls: string[]
  errorMessage?: string
  createdAt: string
}

type ReferenceImage = {
  name: string
  url: string
  file: File
}

type ViewerImage = {
  url: string
  alt: string
  index: number
}

const RUNNINGHUB_SETTINGS_KEY = 'cw-runninghub-settings'
const GEMINI_SETTINGS_KEY = 'cw-gemini-settings'
const GEMINI_SESSION_KEY = 'cw-gemini-session-key'
const GEMINI_REMEMBERED_KEY = 'cw-gemini-remembered-key'
const ACTIVE_PROVIDER_KEY = 'cw-active-provider'
const HISTORY_KEY = 'cw-generation-history'
const POLL_INTERVAL_MS = 2500
const MAX_POLL_ATTEMPTS = Math.ceil((30 * 60 * 1000) / POLL_INTERVAL_MS)

function App() {
  const [prompt, setPrompt] = useState('')
  const [referenceImage, setReferenceImage] = useState<ReferenceImage | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [activeProvider, setActiveProvider] = useState<ProviderId>('runninghub')
  const [settingsProvider, setSettingsProvider] = useState<ProviderId>('runninghub')
  const [runningHubSettings, setRunningHubSettings] = useState<RunningHubSettings>(defaultRunningHubSettings)
  const [runningHubWorkflows, setRunningHubWorkflows] = useState<RunningHubWorkflow[]>(cloneBuiltInWorkflows)
  const [activeWorkflowId, setActiveWorkflowId] = useState(builtInRunningHubWorkflows[0].id)
  const [editingWorkflow, setEditingWorkflow] = useState<RunningHubWorkflow | null>(null)
  const [geminiSettings, setGeminiSettings] = useState<GeminiSettings>(defaultGeminiSettings)
  const [savedNotice, setSavedNotice] = useState('')
  const [history, setHistory] = useState<GenerationItem[]>([])
  const [activeJob, setActiveJob] = useState<GenerationItem | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [downloadingUrl, setDownloadingUrl] = useState('')
  const [viewerImage, setViewerImage] = useState<ViewerImage | null>(null)
  const [toastMessage, setToastMessage] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null)
  const downloadInProgressRef = useRef(false)
  const historyRef = useRef<GenerationItem[]>([])
  const dismissedJobIdsRef = useRef(new Set<string>())

  useEffect(() => {
    const savedRunningHubSettings = window.localStorage.getItem(RUNNINGHUB_SETTINGS_KEY)
    let legacyWorkflow: RunningHubWorkflow | null = null
    if (savedRunningHubSettings) {
      try {
        const storedSettings = JSON.parse(savedRunningHubSettings) as Partial<RunningHubSettings>
        legacyWorkflow = migrateLegacyRunningHubWorkflow(storedSettings)
        setRunningHubSettings({
          apiKey: storedSettings.apiKey ?? '',
          instanceType: storedSettings.instanceType === 'plus' ? 'plus' : 'default',
        })
      } catch {
        window.localStorage.removeItem(RUNNINGHUB_SETTINGS_KEY)
      }
    }

    const storedWorkflowValue = window.localStorage.getItem(RUNNINGHUB_WORKFLOWS_KEY)
    const savedWorkflows = readRunningHubWorkflows(storedWorkflowValue)
    const migratedWorkflows =
      !storedWorkflowValue && legacyWorkflow ? [legacyWorkflow, ...savedWorkflows] : savedWorkflows
    const savedWorkflowId = window.localStorage.getItem(ACTIVE_RUNNINGHUB_WORKFLOW_KEY) ?? ''
    const selectedWorkflow = getWorkflowOrFallback(
      migratedWorkflows,
      savedWorkflowId || legacyWorkflow?.id || '',
    )
    setRunningHubWorkflows(migratedWorkflows)
    setActiveWorkflowId(selectedWorkflow?.id ?? '')
    if (legacyWorkflow && !storedWorkflowValue) {
      window.localStorage.setItem(RUNNINGHUB_WORKFLOWS_KEY, JSON.stringify(migratedWorkflows))
      window.localStorage.setItem(ACTIVE_RUNNINGHUB_WORKFLOW_KEY, legacyWorkflow.id)
    }

    const savedGeminiSettings = readStoredObject<Partial<GeminiSettings>>(GEMINI_SETTINGS_KEY)
    const rememberApiKey = savedGeminiSettings?.rememberApiKey ?? false
    const apiKey = rememberApiKey
      ? window.localStorage.getItem(GEMINI_REMEMBERED_KEY) ?? ''
      : window.sessionStorage.getItem(GEMINI_SESSION_KEY) ?? ''
    setGeminiSettings({ ...defaultGeminiSettings, ...savedGeminiSettings, apiKey, rememberApiKey })

    const savedProvider = window.localStorage.getItem(ACTIVE_PROVIDER_KEY)
    if (savedProvider === 'runninghub' || savedProvider === 'gemini') {
      setActiveProvider(savedProvider)
      setSettingsProvider(savedProvider)
    }

    const savedHistory = window.localStorage.getItem(HISTORY_KEY)
    if (savedHistory) {
      try {
        const parsedHistory = JSON.parse(savedHistory) as GenerationItem[]
        setHistory(parsedHistory)
        historyRef.current = parsedHistory
        setSelectedId(parsedHistory[0]?.id ?? '')
      } catch {
        window.localStorage.removeItem(HISTORY_KEY)
      }
    }
  }, [])

  useEffect(() => {
    return () => {
      if (referenceImage) {
        URL.revokeObjectURL(referenceImage.url)
      }
    }
  }, [referenceImage])

  useEffect(() => {
    const closeDrawers = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSettingsOpen(false)
        setHistoryOpen(false)
      }
    }

    window.addEventListener('keydown', closeDrawers)
    return () => window.removeEventListener('keydown', closeDrawers)
  }, [])

  useEffect(() => {
    const textarea = promptInputRef.current
    if (!textarea) return

    textarea.style.height = 'auto'
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 40), 300)
    textarea.style.height = `${nextHeight}px`
    textarea.style.overflowY = textarea.scrollHeight > 300 ? 'auto' : 'hidden'
  }, [prompt])

  const selectedHistory = useMemo(
    () => history.find((item) => item.id === selectedId) ?? history[0] ?? null,
    [history, selectedId],
  )

  const displayJob = activeJob ?? selectedHistory
  const activeWorkflow = useMemo(
    () => getWorkflowOrFallback(runningHubWorkflows, activeWorkflowId),
    [activeWorkflowId, runningHubWorkflows],
  )
  const activeMode: GenerationMode =
    activeProvider === 'runninghub'
      ? activeWorkflow?.capability ?? 'text-to-image'
      : referenceImage
        ? 'image-to-image'
        : 'text-to-image'

  const saveSettings = () => {
    if (settingsProvider === 'runninghub') {
      window.localStorage.setItem(RUNNINGHUB_SETTINGS_KEY, JSON.stringify(runningHubSettings))
    } else {
      const { apiKey: _apiKey, ...publicSettings } = geminiSettings
      window.localStorage.setItem(GEMINI_SETTINGS_KEY, JSON.stringify(publicSettings))

      if (!geminiSettings.apiKey.trim()) {
        window.sessionStorage.removeItem(GEMINI_SESSION_KEY)
        window.localStorage.removeItem(GEMINI_REMEMBERED_KEY)
      } else if (geminiSettings.rememberApiKey) {
        window.localStorage.setItem(GEMINI_REMEMBERED_KEY, geminiSettings.apiKey)
        window.sessionStorage.removeItem(GEMINI_SESSION_KEY)
      } else {
        window.sessionStorage.setItem(GEMINI_SESSION_KEY, geminiSettings.apiKey)
        window.localStorage.removeItem(GEMINI_REMEMBERED_KEY)
      }
    }

    showSavedNotice(geminiSettings.rememberApiKey && settingsProvider === 'gemini' ? '设置已保存到此设备' : '设置已保存')
  }

  const saveHistory = (nextHistory: GenerationItem[]) => {
    historyRef.current = nextHistory
    setHistory(nextHistory)
    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(sanitizeHistoryForStorage(nextHistory)))
    } catch {
      showToast('历史记录空间不足，本次结果仅在当前页面保留')
    }
  }

  const upsertHistory = (item: GenerationItem, allowInsert = true) => {
    if (dismissedJobIdsRef.current.has(item.id)) return
    const nextHistory = upsertHistoryItem(historyRef.current, item, allowInsert)
    if (nextHistory === historyRef.current) return
    saveHistory(nextHistory)
    setSelectedId(item.id)
  }

  const startNewChat = () => {
    if (activeJob) dismissedJobIdsRef.current.add(activeJob.id)
    setPrompt('')
    clearReferenceImage()
    setActiveJob(null)
    setSelectedId('')
    setHistoryOpen(false)
  }

  const clearHistory = () => {
    historyRef.current.forEach((item) => dismissedJobIdsRef.current.add(item.id))
    if (activeJob) dismissedJobIdsRef.current.add(activeJob.id)
    saveHistory([])
    setSelectedId('')
    setActiveJob(null)
  }

  const removeHistoryItem = (itemId: string) => {
    dismissedJobIdsRef.current.add(itemId)
    const nextHistory = historyRef.current.filter((item) => item.id !== itemId)
    saveHistory(nextHistory)

    if (selectedId === itemId) {
      setSelectedId(nextHistory[0]?.id ?? '')
    }

    setActiveJob((currentJob) => (currentJob?.id === itemId ? null : currentJob))
  }

  const selectHistoryItem = (item: GenerationItem) => {
    setSelectedId(item.id)
    setActiveJob(null)
    setPrompt(item.prompt)

    if (item.providerId) {
      selectProvider(item.providerId)
    }

    if ((item.providerId ?? 'runninghub') === 'runninghub' && item.workflow) {
      selectRunningHubWorkflow(item.workflow.id)
    } else if ((item.providerId ?? 'runninghub') === 'runninghub' && item.mode) {
      const builtInWorkflow = getBuiltInWorkflowForCapability(item.mode)
      if (builtInWorkflow) selectRunningHubWorkflow(builtInWorkflow.id)
    }

    setHistoryOpen(false)
  }

  const retryJob = (item: GenerationItem) => {
    setPrompt(item.prompt)
    setActiveJob(null)

    if (item.providerId) {
      selectProvider(item.providerId)
    }

    if ((item.mode === 'image-to-image' || item.mode === 'image-to-video') && !referenceImage) {
      showToast('重新生成需要先重新上传参考图')
      return
    }

    const legacyWorkflow =
      (item.providerId ?? 'runninghub') === 'runninghub' && !item.workflow && item.mode
        ? getBuiltInWorkflowForCapability(item.mode)
        : undefined

    window.setTimeout(() => {
      void runWorkflow(item.prompt, item.providerId ?? 'runninghub', item.workflow ?? legacyWorkflow, item.mode)
    }, 0)
  }

  const showSavedNotice = (message: string) => {
    setSavedNotice(message)
    window.setTimeout(() => setSavedNotice(''), 2400)
  }

  const showToast = (message: string) => {
    setToastMessage(message)
    window.setTimeout(() => setToastMessage(''), 2400)
  }

  const selectProvider = (providerId: ProviderId) => {
    setActiveProvider(providerId)
    setSettingsProvider(providerId)
    window.localStorage.setItem(ACTIVE_PROVIDER_KEY, providerId)
  }

  const selectRunningHubWorkflow = (workflowId: string) => {
    const workflow = getAvailableRunningHubWorkflows(runningHubWorkflows).find((item) => item.id === workflowId)
    if (!workflow) return
    try {
      persistActiveWorkflow(workflow.id)
    } catch {
      showToast('浏览器无法保存工作流选择')
    }
  }

  const persistRunningHubWorkflows = (workflows: RunningHubWorkflow[]) => {
    window.localStorage.setItem(RUNNINGHUB_WORKFLOWS_KEY, JSON.stringify(workflows))
    setRunningHubWorkflows(workflows)
  }

  const persistActiveWorkflow = (workflowId: string) => {
    if (workflowId) {
      window.localStorage.setItem(ACTIVE_RUNNINGHUB_WORKFLOW_KEY, workflowId)
    } else {
      window.localStorage.removeItem(ACTIVE_RUNNINGHUB_WORKFLOW_KEY)
    }
    setActiveWorkflowId(workflowId)
  }

  const saveWorkflowEditor = () => {
    if (!editingWorkflow) return
    const validationMessage = validateRunningHubWorkflow(editingWorkflow)
    if (validationMessage) {
      showSavedNotice(validationMessage)
      return
    }

    try {
      const nextWorkflows = upsertRunningHubWorkflow(runningHubWorkflows, editingWorkflow)
      persistRunningHubWorkflows(nextWorkflows)
      const selectedWorkflow = getWorkflowOrFallback(nextWorkflows, activeWorkflowId)
      if (!selectedWorkflow || selectedWorkflow.id !== activeWorkflowId) {
        const fallbackId = selectedWorkflow?.id ?? ''
        persistActiveWorkflow(fallbackId)
      }
      setEditingWorkflow(null)
      showSavedNotice('工作流已保存')
    } catch (error) {
      showSavedNotice(getErrorMessage(error))
    }
  }

  const deleteWorkflow = (workflowId: string) => {
    try {
      const nextWorkflows = removeRunningHubWorkflow(runningHubWorkflows, workflowId)
      persistRunningHubWorkflows(nextWorkflows)

      if (workflowId === activeWorkflowId) {
        const fallback = getWorkflowOrFallback(nextWorkflows, '')
        persistActiveWorkflow(fallback?.id ?? '')
      }

      if (editingWorkflow?.id === workflowId) setEditingWorkflow(null)
      showSavedNotice('工作流已删除')
    } catch {
      showSavedNotice('浏览器无法保存更改，请检查存储权限或空间')
    }
  }

  const restoreBuiltInWorkflows = () => {
    try {
      const customWorkflows = runningHubWorkflows.filter(
        (workflow) => !builtInRunningHubWorkflows.some((builtIn) => builtIn.id === workflow.id),
      )
      const nextWorkflows = [...cloneBuiltInWorkflows(), ...customWorkflows]
      persistRunningHubWorkflows(nextWorkflows)
      const fallback = getWorkflowOrFallback(nextWorkflows, activeWorkflowId)
      persistActiveWorkflow(fallback?.id ?? '')
      showSavedNotice('内置工作流已恢复')
    } catch {
      showSavedNotice('浏览器无法保存更改，请检查存储权限或空间')
    }
  }

  const copyImage = async (url: string) => {
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
        throw new Error('Clipboard API is unavailable')
      }

      const imageBlob = await fetchImageAsPng(url)
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': imageBlob })])
      showToast('图片已复制')
    } catch {
      showToast('复制图片失败，请使用下载')
    }
  }

  const downloadResult = async (url: string, index: number) => {
    if (downloadInProgressRef.current) return

    downloadInProgressRef.current = true
    setDownloadingUrl(url)
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = makeDownloadFilename(url, blob.type, index)
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
      showToast('下载已开始')
    } catch {
      showToast('下载失败，请稍后重试或在图片上右键保存')
    } finally {
      downloadInProgressRef.current = false
      setDownloadingUrl('')
    }
  }

  const refreshJobResult = async (item: GenerationItem) => {
    if ((item.providerId ?? 'runninghub') !== 'runninghub') {
      showToast('NanoBanana 请求会同步返回，不需要刷新任务')
      return
    }

    if (!runningHubSettings.apiKey.trim()) {
      setSettingsOpen(true)
      showSavedNotice('请先填写 RunningHub API Key')
      return
    }

    if (!item.taskId) {
      showToast('这个任务没有保存 Task ID，无法刷新结果')
      return
    }

    setIsGenerating(true)
    setActiveJob({ ...item, errorMessage: undefined })

    try {
      const queryData = await runningHubAdapter.queryTask?.(runningHubSettings, item.taskId)
      if (!queryData) throw new Error('RunningHub 未提供任务查询能力。')
      const refreshedJob = mergeProviderTask(item, queryData)

      setActiveJob(refreshedJob)
      upsertHistory(refreshedJob)
      showToast(refreshedJob.status === 'SUCCESS' ? '结果已刷新' : '任务仍在生成')
    } catch (error) {
      const failedJob: GenerationItem = {
        ...item,
        status: 'FAILED',
        errorMessage: getErrorMessage(error),
      }
      setActiveJob(failedJob)
      upsertHistory(failedJob)
    } finally {
      setIsGenerating(false)
    }
  }

  const openReferencePicker = () => {
    fileInputRef.current?.click()
  }

  const selectReferenceImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    if (!file.type.startsWith('image/')) {
      showToast('请上传图片文件')
      return
    }

    if (referenceImage) {
      URL.revokeObjectURL(referenceImage.url)
    }

    setReferenceImage({
      name: file.name,
      url: URL.createObjectURL(file),
      file,
    })
    showToast(activeProvider === 'gemini' ? '参考图已添加，将使用图生图' : '参考图已添加')
  }

  const clearReferenceImage = () => {
    setReferenceImage((currentImage) => {
      if (currentImage) {
        URL.revokeObjectURL(currentImage.url)
      }

      return null
    })
  }

  const runWorkflow = async (
    promptOverride?: string,
    providerOverride?: ProviderId,
    workflowOverride?: RunningHubWorkflow,
    modeOverride?: GenerationMode,
  ) => {
    const cleanPrompt = (promptOverride ?? prompt).trim()
    const providerId = providerOverride ?? activeProvider
    const workflow = providerId === 'runninghub' ? workflowOverride ?? activeWorkflow : undefined
    const runningHubRequestSettings = { ...runningHubSettings, workflow }

    const configured =
      providerId === 'gemini'
        ? geminiAdapter.isConfigured(geminiSettings)
        : runningHubAdapter.isConfigured(runningHubRequestSettings)

    if (!configured) {
      setSettingsProvider(providerId)
      setSettingsOpen(true)
      showSavedNotice(
        providerId === 'gemini'
          ? '请补全 NanoBanana 连接设置'
          : runningHubSettings.apiKey.trim()
            ? '请先添加并选择 RunningHub 工作流'
            : '请先填写 RunningHub API Key',
      )
      return
    }

    if (!cleanPrompt) {
      setActiveJob({
        id: crypto.randomUUID(),
        title: '请输入创作描述',
        prompt: '',
        status: 'FAILED',
        resultUrls: [],
        errorMessage: '先描述你想生成的图片，再开始生成。',
        createdAt: new Date().toISOString(),
      })
      return
    }

    const imageInput = referenceImage
    const mode = resolveGenerationMode(providerId, Boolean(imageInput), workflow?.capability, modeOverride)

    if (providerId === 'runninghub' && mode !== 'text-to-image' && !imageInput) {
      showToast('当前工作流需要先上传参考图')
      return
    }

    const job: GenerationItem = {
      id: crypto.randomUUID(),
      title: makeTitle(cleanPrompt),
      prompt: cleanPrompt,
      providerId,
      mode,
      workflow: providerId === 'runninghub' ? workflow : undefined,
      status: 'RUNNING',
      resultUrls: [],
      createdAt: new Date().toISOString(),
    }

    setIsGenerating(true)
    setActiveJob(job)
    dismissedJobIdsRef.current.delete(job.id)

    let trackedJob = job

    try {
      if (imageInput) {
        showToast(providerId === 'gemini' ? '正在读取参考图' : '正在上传参考图到 RunningHub')
      }

      const submitData =
        providerId === 'gemini'
          ? await submitGeminiWorkflow(geminiSettings, cleanPrompt, mode, imageInput?.file)
          : await submitRunningHubWorkflow(runningHubRequestSettings, cleanPrompt, mode, imageInput?.file)

      trackedJob = mergeProviderTask(job, submitData)
      setActiveJob(trackedJob)
      upsertHistory(trackedJob)

      if (providerId === 'runninghub') {
        if (!trackedJob.taskId) {
          throw new Error('提交成功，但 RunningHub 没有返回任务 ID。')
        }

        const completedJob = await pollRunningHubTask(trackedJob)
        if (!dismissedJobIdsRef.current.has(completedJob.id)) {
          setActiveJob(completedJob)
          upsertHistory(completedJob, false)
        }
      }
    } catch (error) {
      const adapter = providerId === 'gemini' ? geminiAdapter : runningHubAdapter
      const failedJob: GenerationItem = {
        ...trackedJob,
        status: 'FAILED',
        errorMessage: getErrorMessage(adapter.normalizeError(error)),
      }
      if (!dismissedJobIdsRef.current.has(failedJob.id)) {
        setActiveJob(failedJob)
        upsertHistory(failedJob)
      }
    } finally {
      setIsGenerating(false)
    }
  }

  const pollRunningHubTask = async (job: GenerationItem): Promise<GenerationItem> => {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
      await wait(POLL_INTERVAL_MS)

      if (!job.taskId || !runningHubAdapter.queryTask) {
        throw new Error('RunningHub 未提供可查询的任务 ID。')
      }

      const queryData = await runningHubAdapter.queryTask(runningHubSettings, job.taskId)

      const nextStatus = queryData.status
      const nextJob = { ...job, status: nextStatus }
      setActiveJob(nextJob)

      if (nextStatus === 'SUCCESS') {
        const resultUrls = extractProviderUrls(queryData)

        return {
          ...nextJob,
          resultUrls,
          errorMessage: resultUrls.length ? undefined : '任务成功，但没有返回结果链接。',
        }
      }

      if (nextStatus === 'FAILED') {
        throw new Error(queryData.errorMessage || 'RunningHub 任务生成失败。')
      }
    }

    return {
      ...job,
      status: 'PENDING_RESULT',
      errorMessage: '仍在生成，可稍后刷新结果。RunningHub 任务会继续运行。',
    }
  }

  return (
    <main className="app-shell">
      <div className="scene" aria-hidden="true">
        <AuroraBackground />
        <div className="grid-glow" />
      </div>

      <nav className="quick-tools" aria-label="创作工具">
        <button
          className="icon-button"
          type="button"
          aria-label="打开设置"
          title="设置"
          onClick={() => {
            setHistoryOpen(false)
            setSettingsOpen(true)
          }}
        >
          <Settings2 aria-hidden="true" />
        </button>
        <button className="icon-button" type="button" aria-label="新对话" title="新对话" onClick={startNewChat}>
          <Plus aria-hidden="true" />
        </button>
        <button
          className={`icon-button ${historyOpen ? 'is-active' : ''}`}
          type="button"
          aria-label="历史记录"
          aria-expanded={historyOpen}
          title="历史记录"
          onClick={() => {
            setSettingsOpen(false)
            setHistoryOpen((open) => !open)
          }}
        >
          <History aria-hidden="true" />
        </button>
      </nav>

      <p className="brand-mark">CREATIVE WORKSHOP</p>

      <section className="workspace">
        <section className="conversation-panel">
          {displayJob && (
            <article className={`result-stage ${displayJob.status === 'FAILED' ? 'is-error' : ''}`}>
              {displayJob.status === 'SUCCESS' && displayJob.resultUrls.length > 0 ? (
                <div className={`result-grid ${displayJob.mode === 'image-to-video' ? 'has-video' : ''}`}>
                  {displayJob.resultUrls.map((url, index) => (
                    <figure className="result-image" key={`${displayJob.id}-${index}`}>
                      {isVideoResult(url, displayJob.mode) ? (
                        <video src={url} controls playsInline />
                      ) : (
                        <button
                          className="result-image-button"
                          type="button"
                          onClick={() =>
                            setViewerImage({
                              url,
                              alt: displayJob.prompt,
                              index,
                            })
                          }
                          aria-label={`查看完整图片${index + 1}`}
                          title="查看完整图片"
                        >
                          <img src={url} alt={displayJob.prompt} />
                        </button>
                      )}
                    </figure>
                  ))}
                </div>
              ) : (
                <div className="task-state">
                  <div className={`task-orb ${displayJob.status === 'FAILED' ? 'is-error' : ''}`} />
                  <p>{getJobMessage(displayJob)}</p>
                </div>
              )}

              {displayJob.taskId && <p className="task-id">Task ID：{displayJob.taskId}</p>}
              <div className="result-actions">
                <button type="button" onClick={() => retryJob(displayJob)} disabled={isGenerating} aria-label="重新生成" title="重新生成">
                  <RotateCcw aria-hidden="true" />
                </button>
                {displayJob.taskId && (
                  <button type="button" onClick={() => refreshJobResult(displayJob)} disabled={isGenerating} aria-label="刷新结果" title="刷新结果">
                    <RefreshCw aria-hidden="true" />
                  </button>
                )}
                {displayJob.resultUrls.map((url, index) => {
                  const isVideo = isVideoResult(url, displayJob.mode)
                  return (
                    <span className="image-actions" key={url}>
                      {!isVideo && (
                        <button type="button" onClick={() => copyImage(url)} aria-label={`复制图片${index + 1}`} title="复制图片">
                          <Copy aria-hidden="true" />
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={Boolean(downloadingUrl)}
                        onClick={() => downloadResult(url, index)}
                        aria-label={downloadingUrl === url ? `正在下载结果${index + 1}` : `下载结果${index + 1}`}
                        title={downloadingUrl === url ? '正在下载' : '下载'}
                      >
                        <Download aria-hidden="true" />
                      </button>
                    </span>
                  )
                })}
              </div>
              {(displayJob.providerId ?? 'runninghub') === 'runninghub' && (
                <p className="expiry-note">RunningHub 返回的结果链接约 24 小时后可能失效，请及时下载。</p>
              )}
            </article>
          )}
        </section>

        <section className="composer" aria-label="创作输入框">
          {referenceImage && (
            <div className="reference-preview">
              <img src={referenceImage.url} alt="" />
              <button type="button" onClick={clearReferenceImage} aria-label="移除参考图">
                ×
              </button>
            </div>
          )}
          <textarea
            ref={promptInputRef}
            value={prompt}
            maxLength={2000}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={
              activeMode === 'image-to-video'
                ? '描述你想让图片如何动起来。比如：镜头缓慢推进，头发和衣摆随风轻轻摆动，电影感...'
                : referenceImage
                ? '描述你想如何修改这张图。比如：保留人物姿势，改成赛博朋克灯光，增强电影感...'
                : '描述你的想法，或上传参考图。比如：生成一张国风少女海报，红色斗篷，雪景，电影感...'
            }
          />
          <div className="composer-footer">
            <div className="composer-tools">
              <button
                className="round-tool"
                type="button"
                aria-label="上传参考图"
                onClick={openReferencePicker}
              >
                <Plus aria-hidden="true" />
              </button>
              <label className="provider-picker">
                <span className="sr-only">创作平台</span>
                <select value={activeProvider} onChange={(event) => selectProvider(event.target.value as ProviderId)}>
                  <option value="runninghub">RunningHub</option>
                  <option value="gemini">NanoBanana</option>
                </select>
              </label>
              {activeProvider === 'runninghub' && (
                <label className="workflow-picker">
                  <span className="sr-only">RunningHub 工作流</span>
                  <select
                    value={activeWorkflow?.id ?? ''}
                    onChange={(event) => selectRunningHubWorkflow(event.target.value)}
                    disabled={!getAvailableRunningHubWorkflows(runningHubWorkflows).length}
                  >
                    {!getAvailableRunningHubWorkflows(runningHubWorkflows).length && (
                      <option value="">请先添加工作流</option>
                    )}
                    {getAvailableRunningHubWorkflows(runningHubWorkflows).map((workflow) => (
                      <option value={workflow.id} key={workflow.id}>
                        {workflow.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className="composer-actions">
              <span>{prompt.length}/2000</span>
              <button
                className={`send-button ${isGenerating ? 'is-generating' : ''}`}
                type="button"
                aria-label={isGenerating ? '停止生成' : '生成内容'}
                onClick={() => {
                  if (!isGenerating) runWorkflow()
                }}
              >
                {isGenerating ? <span className="stop-glyph" aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}
              </button>
            </div>
          </div>
        </section>
      </section>

      <div
        className={`drawer-backdrop ${settingsOpen || historyOpen ? 'is-open' : ''}`}
        onClick={() => {
          setSettingsOpen(false)
          setHistoryOpen(false)
        }}
        aria-hidden="true"
      />
      <aside className={`history-drawer ${historyOpen ? 'is-open' : ''}`} aria-label="历史记录">
        <div className="history-heading">
          <div>
            <p className="section-label">历史记录</p>
            <span>{history.length} 条创作</span>
          </div>
          <div className="history-heading-actions">
            {history.length > 0 && (
              <button className="icon-button" type="button" onClick={clearHistory} aria-label="清空历史" title="清空历史">
                <Trash2 aria-hidden="true" />
              </button>
            )}
            <button className="icon-button" type="button" onClick={() => setHistoryOpen(false)} aria-label="关闭历史记录" title="关闭">
              <X aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="history-list">
          {history.length ? (
            history.map((item) => (
              <div className={`history-row ${item.id === selectedId ? 'is-active' : ''}`} key={item.id}>
                <button className="history-item" type="button" onClick={() => selectHistoryItem(item)}>
                  <span className="history-thumb">
                    {getThumbnail(item) ? <img src={getThumbnail(item)} alt="" /> : <span />}
                  </span>
                  <span className="history-copy">
                    <span className="history-title">{item.title}</span>
                    <span className="history-meta">
                      {formatTime(item.createdAt)} · {formatStatus(item.status)}
                    </span>
                  </span>
                </button>
                <button
                  className="history-delete"
                  type="button"
                  aria-label={`删除历史记录：${item.title}`}
                  title="删除"
                  onClick={() => removeHistoryItem(item.id)}
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </div>
            ))
          ) : (
            <p className="empty-history">暂无历史记录</p>
          )}
        </div>
      </aside>
      <aside className={`settings-drawer ${settingsOpen ? 'is-open' : ''}`} aria-label="平台连接设置">
        <div className="drawer-header">
          <div>
            <p>连接设置</p>
            <h2>{settingsProvider === 'gemini' ? 'NanoBanana' : 'RunningHub'}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="关闭设置" onClick={() => setSettingsOpen(false)}>
            <X aria-hidden="true" />
          </button>
        </div>

        <div className="provider-tabs" aria-label="选择设置平台">
          <button
            className={settingsProvider === 'runninghub' ? 'is-active' : ''}
            type="button"
            aria-pressed={settingsProvider === 'runninghub'}
            onClick={() => setSettingsProvider('runninghub')}
          >
            RunningHub
          </button>
          <button
            className={settingsProvider === 'gemini' ? 'is-active' : ''}
            type="button"
            aria-pressed={settingsProvider === 'gemini'}
            onClick={() => setSettingsProvider('gemini')}
          >
            NanoBanana
          </button>
        </div>

        {settingsProvider === 'runninghub' ? (
          <>
            <label>
              API Key
              <span className={`key-state ${runningHubSettings.apiKey.trim() ? 'is-connected' : ''}`}>
                {runningHubSettings.apiKey.trim() ? '已连接，密钥保存在当前浏览器' : '未连接'}
              </span>
              <input
                type="password"
                autoComplete="off"
                value={runningHubSettings.apiKey}
                placeholder="粘贴你的 RunningHub API Key"
                onChange={(event) => setRunningHubSettings({ ...runningHubSettings, apiKey: event.target.value })}
              />
            </label>

            <section className="workflow-manager" aria-label="RunningHub 工作流管理">
              <div className="workflow-manager-heading">
                <div>
                  <p>工作流管理</p>
                  <span>{runningHubWorkflows.length} 个工作流</span>
                </div>
                <button
                  className="workflow-add-button"
                  type="button"
                  onClick={() => setEditingWorkflow(createWorkflowDraft())}
                >
                  <Plus aria-hidden="true" />
                  添加
                </button>
              </div>

              <div className="workflow-list">
                {runningHubWorkflows.map((workflow) => (
                  <div className={`workflow-row ${workflow.id === activeWorkflow?.id ? 'is-active' : ''}`} key={workflow.id}>
                    <button
                      className="workflow-select"
                      type="button"
                      disabled={!workflow.enabled}
                      onClick={() => selectRunningHubWorkflow(workflow.id)}
                    >
                      <span>{workflow.name}</span>
                      <small>
                        {getCapabilityLabel(workflow.capability)}
                        {!workflow.enabled ? ' · 已停用' : workflow.id === activeWorkflow?.id ? ' · 当前使用' : ''}
                      </small>
                    </button>
                    <div className="workflow-row-actions">
                      <button
                        type="button"
                        aria-label={`编辑工作流：${workflow.name}`}
                        title="编辑"
                        onClick={() =>
                          setEditingWorkflow({
                            ...workflow,
                            promptNode: { ...workflow.promptNode },
                            imageNode: workflow.imageNode ? { ...workflow.imageNode } : undefined,
                          })
                        }
                      >
                        <Pencil aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`删除工作流：${workflow.name}`}
                        title="删除"
                        onClick={() => deleteWorkflow(workflow.id)}
                      >
                        <Trash2 aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))}
                {!runningHubWorkflows.length && <p className="workflow-empty">暂无工作流，请先添加。</p>}
              </div>

              {editingWorkflow && (
                <div className="workflow-editor">
                  <div className="workflow-editor-heading">
                    <strong>{runningHubWorkflows.some((item) => item.id === editingWorkflow.id) ? '编辑工作流' : '添加工作流'}</strong>
                    <button type="button" aria-label="关闭工作流编辑" onClick={() => setEditingWorkflow(null)}>
                      <X aria-hidden="true" />
                    </button>
                  </div>
                  <label>
                    工作流名称
                    <input
                      type="text"
                      value={editingWorkflow.name}
                      placeholder="例如：产品摄影"
                      onChange={(event) => setEditingWorkflow({ ...editingWorkflow, name: event.target.value })}
                    />
                  </label>
                  <label>
                    功能类型
                    <select
                      value={editingWorkflow.capability}
                      onChange={(event) => {
                        const capability = event.target.value as RunningHubWorkflow['capability']
                        setEditingWorkflow({
                          ...editingWorkflow,
                          capability,
                          imageNode:
                            capability === 'text-to-image'
                              ? undefined
                              : editingWorkflow.imageNode ?? { nodeId: '', fieldName: 'image' },
                        })
                      }}
                    >
                      <option value="text-to-image">文生图</option>
                      <option value="image-to-image">图生图</option>
                      <option value="image-to-video">图生视频</option>
                    </select>
                  </label>
                  <label>
                    Workflow ID
                    <input
                      type="text"
                      inputMode="numeric"
                      value={editingWorkflow.workflowId}
                      placeholder="RunningHub 工作流 ID"
                      onChange={(event) => setEditingWorkflow({ ...editingWorkflow, workflowId: event.target.value })}
                    />
                  </label>
                  <div className="workflow-node-grid">
                    <label>
                      提示词节点 ID
                      <input
                        type="text"
                        value={editingWorkflow.promptNode.nodeId}
                        onChange={(event) =>
                          setEditingWorkflow({
                            ...editingWorkflow,
                            promptNode: { ...editingWorkflow.promptNode, nodeId: event.target.value },
                          })
                        }
                      />
                    </label>
                    <label>
                      提示词字段名
                      <input
                        type="text"
                        value={editingWorkflow.promptNode.fieldName}
                        onChange={(event) =>
                          setEditingWorkflow({
                            ...editingWorkflow,
                            promptNode: { ...editingWorkflow.promptNode, fieldName: event.target.value },
                          })
                        }
                      />
                    </label>
                  </div>
                  {editingWorkflow.capability !== 'text-to-image' && editingWorkflow.imageNode && (
                    <div className="workflow-node-grid">
                      <label>
                        参考图节点 ID
                        <input
                          type="text"
                          value={editingWorkflow.imageNode.nodeId}
                          onChange={(event) =>
                            setEditingWorkflow({
                              ...editingWorkflow,
                              imageNode: { ...editingWorkflow.imageNode!, nodeId: event.target.value },
                            })
                          }
                        />
                      </label>
                      <label>
                        参考图字段名
                        <input
                          type="text"
                          value={editingWorkflow.imageNode.fieldName}
                          onChange={(event) =>
                            setEditingWorkflow({
                              ...editingWorkflow,
                              imageNode: { ...editingWorkflow.imageNode!, fieldName: event.target.value },
                            })
                          }
                        />
                      </label>
                    </div>
                  )}
                  <label className="remember-key">
                    <input
                      type="checkbox"
                      checked={editingWorkflow.enabled}
                      onChange={(event) => setEditingWorkflow({ ...editingWorkflow, enabled: event.target.checked })}
                    />
                    <span>启用这个工作流</span>
                  </label>
                  <button className="workflow-save-button" type="button" onClick={saveWorkflowEditor}>
                    保存工作流
                  </button>
                </div>
              )}

              <button className="workflow-restore-button" type="button" onClick={restoreBuiltInWorkflows}>
                <RotateCcw aria-hidden="true" />
                恢复内置工作流
              </button>
            </section>
          </>
        ) : (
          <>
            <p className="provider-scope">{getGeminiProtocolDescription(geminiSettings.protocol)}</p>
            <label>
              接口协议
              <select
                value={geminiSettings.protocol}
                onChange={(event) =>
                  setGeminiSettings({
                    ...geminiSettings,
                    protocol: event.target.value as GeminiSettings['protocol'],
                  })
                }
              >
                <option value="google-interactions">Google Gemini Interactions</option>
                <option value="newapi-gemini">New API 原生 Gemini</option>
                <option value="openai-images">OpenAI Images 兼容</option>
              </select>
            </label>
            <label>
              API Base URL
              <input
                type="url"
                spellCheck="false"
                value={geminiSettings.baseUrl}
                placeholder="https://generativelanguage.googleapis.com/v1"
                onChange={(event) => setGeminiSettings({ ...geminiSettings, baseUrl: event.target.value })}
              />
            </label>
            <label>
              Model ID
              <input
                type="text"
                spellCheck="false"
                value={geminiSettings.modelId}
                placeholder="gemini-3.1-flash-image"
                onChange={(event) => setGeminiSettings({ ...geminiSettings, modelId: event.target.value })}
              />
            </label>
            <label>
              API Key
              <span className={`key-state ${geminiSettings.apiKey.trim() ? 'is-connected' : ''}`}>
                {geminiSettings.apiKey.trim() ? '已填写，将由浏览器发送到接口地址' : '未连接'}
              </span>
              <input
                type="password"
                autoComplete="off"
                value={geminiSettings.apiKey}
                placeholder="粘贴你的 API Key"
                onChange={(event) => setGeminiSettings({ ...geminiSettings, apiKey: event.target.value })}
              />
            </label>
            <label className="remember-key">
              <input
                type="checkbox"
                checked={geminiSettings.rememberApiKey}
                onChange={(event) =>
                  setGeminiSettings({ ...geminiSettings, rememberApiKey: event.target.checked })
                }
              />
              <span>在此设备记住密钥</span>
            </label>
            <p className="key-guidance">
              默认仅保存到当前浏览器会话。启用记住后，密钥会保存在此设备的浏览器存储中。
            </p>
          </>
        )}

        <button
          className="save-button"
          type="button"
          onClick={() => {
            saveSettings()
            selectProvider(settingsProvider)
          }}
        >
          保存并使用
        </button>
        {savedNotice && <p className="saved-notice">{savedNotice}</p>}
      </aside>

      <input ref={fileInputRef} className="file-input" type="file" accept="image/*" onChange={selectReferenceImage} />
      {viewerImage && (
        <ImageViewer
          image={viewerImage}
          downloading={downloadingUrl === viewerImage.url}
          onClose={() => setViewerImage(null)}
          onDownload={() => downloadResult(viewerImage.url, viewerImage.index)}
        />
      )}
      {toastMessage && <div className="toast-message">{toastMessage}</div>}
    </main>
  )
}

type ImageViewerProps = {
  image: ViewerImage
  downloading: boolean
  onClose: () => void
  onDownload: () => void
}

function ImageViewer({ image, downloading, onClose, onDownload }: ImageViewerProps) {
  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragOrigin, setDragOrigin] = useState<{ x: number; y: number } | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [onClose])

  const updateScale = (nextScale: number) => {
    const boundedScale = Math.min(4, Math.max(0.25, nextScale))
    setScale(boundedScale)
    if (boundedScale <= 1) setPan({ x: 0, y: 0 })
  }

  const resetView = () => {
    setScale(1)
    setPan({ x: 0, y: 0 })
  }

  return (
    <div
      className="image-viewer"
      role="dialog"
      aria-modal="true"
      aria-label="图片查看器"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="image-viewer-toolbar">
        <button
          type="button"
          disabled={downloading}
          onClick={onDownload}
          aria-label={downloading ? '正在下载图片' : '下载图片'}
          title={downloading ? '正在下载' : '下载图片'}
        >
          <Download aria-hidden="true" />
        </button>
        <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="关闭图片查看器" title="关闭">
          <X aria-hidden="true" />
        </button>
      </div>

      <div
        className={`image-viewer-stage ${dragOrigin ? 'is-dragging' : ''}`}
        onWheel={(event) => {
          event.preventDefault()
          updateScale(scale + (event.deltaY < 0 ? 0.15 : -0.15))
        }}
        onPointerDown={(event) => {
          if (scale <= 1) return
          event.currentTarget.setPointerCapture(event.pointerId)
          setDragOrigin({
            x: event.clientX - pan.x,
            y: event.clientY - pan.y,
          })
        }}
        onPointerMove={(event) => {
          if (!dragOrigin) return
          setPan({
            x: event.clientX - dragOrigin.x,
            y: event.clientY - dragOrigin.y,
          })
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
          setDragOrigin(null)
        }}
        onPointerCancel={() => setDragOrigin(null)}
      >
        <img
          className="image-viewer-image"
          src={image.url}
          alt={image.alt}
          draggable={false}
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${scale})`,
          }}
        />
      </div>

      <div className="image-viewer-controls" aria-label="图片缩放控制">
        <button type="button" onClick={() => updateScale(scale - 0.25)} aria-label="缩小图片" title="缩小">
          <Minus aria-hidden="true" />
        </button>
        <output aria-live="polite">{Math.round(scale * 100)}%</output>
        <button type="button" onClick={() => updateScale(scale + 0.25)} aria-label="放大图片" title="放大">
          <Plus aria-hidden="true" />
        </button>
        <button type="button" onClick={resetView} aria-label="适应窗口" title="适应窗口">
          <Scan aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

async function fetchImageAsPng(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)

  const sourceBlob = await response.blob()
  if (sourceBlob.type === 'image/png') return sourceBlob

  const bitmap = await createImageBitmap(sourceBlob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas is unavailable')
    context.drawImage(bitmap, 0, 0)

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Image conversion failed'))
      }, 'image/png')
    })
  } finally {
    bitmap.close()
  }
}

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function makeDownloadFilename(url: string, mimeType: string, index: number) {
  const extensionFromUrl = url.match(/\.([a-zA-Z0-9]{2,5})(?:[?#]|$)/)?.[1]?.toLowerCase()
  const extensionFromMime = mimeType.split('/')[1]?.split(';')[0]?.replace('jpeg', 'jpg')
  const extension = extensionFromUrl || extensionFromMime || 'png'
  return `creative-workshop-${Date.now()}-${index + 1}.${extension}`
}

async function submitGeminiWorkflow(
  settings: GeminiSettings,
  prompt: string,
  mode: GenerationMode,
  file?: File,
) {
  const media =
    mode === 'image-to-image' && file && geminiAdapter.uploadMedia
      ? [await geminiAdapter.uploadMedia(settings, file)]
      : undefined
  return geminiAdapter.submitTask(settings, { prompt, capability: mode, media })
}

async function submitRunningHubWorkflow(
  settings: RunningHubSettings,
  prompt: string,
  mode: GenerationMode,
  file?: File,
) {
  const media =
    mode !== 'text-to-image' && file && runningHubAdapter.uploadMedia
      ? [await runningHubAdapter.uploadMedia(settings, file)]
      : undefined
  return runningHubAdapter.submitTask(settings, { prompt, capability: mode, media })
}

function getCapabilityLabel(capability: RunningHubWorkflow['capability']) {
  if (capability === 'image-to-image') return '图生图'
  if (capability === 'image-to-video') return '图生视频'
  return '文生图'
}

function makeTitle(prompt: string) {
  return prompt.replace(/[，。,.!！?？]/g, ' ').trim().split(/\s+/).join('').slice(0, 12) || '新的创作'
}

function getErrorMessage(error: unknown) {
  if (error instanceof TypeError && error.message === 'Failed to fetch') {
    return '请求被浏览器拦截或网络不可用。如果 API Key 正确，可能需要增加代理接口。'
  }

  if (error instanceof Error) {
    return error.message
  }

  return '生成失败，请稍后重试。'
}

function mergeProviderTask(job: GenerationItem, task: ProviderTask): GenerationItem {
  const nextStatus = task.status

  if (nextStatus === 'SUCCESS') {
    const resultUrls = extractProviderUrls(task)

    return {
      ...job,
      taskId: task.taskId ?? job.taskId,
      status: 'SUCCESS',
      resultUrls,
      errorMessage: resultUrls.length ? undefined : '任务成功，但没有返回结果链接。',
    }
  }

  if (nextStatus === 'FAILED') {
    return {
      ...job,
      taskId: task.taskId ?? job.taskId,
      status: 'FAILED',
      errorMessage: task.errorMessage || '平台生成任务失败。',
    }
  }

  return {
    ...job,
    taskId: task.taskId ?? job.taskId,
    status: nextStatus,
    errorMessage: task.errorMessage,
  }
}

function extractProviderUrls(task: ProviderTask) {
  return task.outputs.map((output) => output.url).filter((url): url is string => Boolean(url))
}

function sanitizeHistoryForStorage(history: GenerationItem[]) {
  return history.map((item) => ({
    ...item,
    resultUrls: item.resultUrls.filter((url) => !url.startsWith('data:')),
    errorMessage:
      item.status === 'SUCCESS' && item.resultUrls.some((url) => url.startsWith('data:'))
        ? 'NanoBanana 图片只保留在生成时的页面中，请及时下载。'
        : item.errorMessage,
  }))
}

function readStoredObject<T>(key: string): T | null {
  const value = window.localStorage.getItem(key)
  if (!value) return null

  try {
    return JSON.parse(value) as T
  } catch {
    window.localStorage.removeItem(key)
    return null
  }
}

function formatStatus(status: GenerationStatus) {
  const statusMap: Record<GenerationStatus, string> = {
    IDLE: '待开始',
    QUEUED: '排队中',
    RUNNING: '生成中',
    SUCCESS: '完成',
    FAILED: '失败',
    PENDING_RESULT: '等待结果',
  }

  return statusMap[status]
}

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '刚刚'
  }

  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getJobMessage(job: GenerationItem) {
  if (job.errorMessage) {
    return job.errorMessage
  }

  if (job.status === 'QUEUED') {
    return '任务已提交，正在排队。'
  }

  if (job.status === 'RUNNING') {
    const providerName = (job.providerId ?? 'runninghub') === 'gemini' ? 'NanoBanana' : 'RunningHub'
    return job.mode === 'image-to-video'
      ? `${providerName} 正在生成视频，请稍等。`
      : `${providerName} 正在生成图片，请稍等。`
  }

  if (job.status === 'PENDING_RESULT') {
    return '仍在生成，可稍后点击刷新结果。'
  }

  return '准备开始生成。'
}

function getThumbnail(item: GenerationItem) {
  return item.resultUrls[0]
}

function isVideoResult(url: string, mode?: GenerationMode) {
  return mode === 'image-to-video' || /\.(mp4|webm|mov)(\?|#|$)/i.test(url)
}

export default App

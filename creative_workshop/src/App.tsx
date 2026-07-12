import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
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
import './App.css'

type GenerationMode = 'text-to-image' | 'image-to-image' | 'image-to-video'
type ReferenceMode = Exclude<GenerationMode, 'text-to-image'>
type GenerationStatus = RunningHubStatus | 'PENDING_RESULT'

type GenerationItem = {
  id: string
  title: string
  prompt: string
  providerId?: ProviderId
  mode?: GenerationMode
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
  const [referenceMode, setReferenceMode] = useState<ReferenceMode>('image-to-image')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [selectedId, setSelectedId] = useState('')
  const [activeProvider, setActiveProvider] = useState<ProviderId>('runninghub')
  const [settingsProvider, setSettingsProvider] = useState<ProviderId>('runninghub')
  const [runningHubSettings, setRunningHubSettings] = useState<RunningHubSettings>(defaultRunningHubSettings)
  const [geminiSettings, setGeminiSettings] = useState<GeminiSettings>(defaultGeminiSettings)
  const [savedNotice, setSavedNotice] = useState('')
  const [history, setHistory] = useState<GenerationItem[]>([])
  const [activeJob, setActiveJob] = useState<GenerationItem | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [toastMessage, setToastMessage] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const savedRunningHubSettings = window.localStorage.getItem(RUNNINGHUB_SETTINGS_KEY)
    if (savedRunningHubSettings) {
      try {
        setRunningHubSettings({ ...defaultRunningHubSettings, ...JSON.parse(savedRunningHubSettings) })
      } catch {
        window.localStorage.removeItem(RUNNINGHUB_SETTINGS_KEY)
      }
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

  const selectedHistory = useMemo(
    () => history.find((item) => item.id === selectedId) ?? history[0] ?? null,
    [history, selectedId],
  )

  const displayJob = activeJob ?? selectedHistory
  const activeMode: GenerationMode = referenceImage ? referenceMode : 'text-to-image'

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
    setHistory(nextHistory)
    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(sanitizeHistoryForStorage(nextHistory)))
    } catch {
      showToast('历史记录空间不足，本次结果仅在当前页面保留')
    }
  }

  const upsertHistory = (item: GenerationItem) => {
    const nextHistory = [item, ...history.filter((historyItem) => historyItem.id !== item.id)].slice(0, 30)
    saveHistory(nextHistory)
    setSelectedId(item.id)
  }

  const startNewChat = () => {
    setPrompt('')
    clearReferenceImage()
    setActiveJob(null)
    setSelectedId('')
  }

  const clearHistory = () => {
    saveHistory([])
    setSelectedId('')
    setActiveJob(null)
  }

  const selectHistoryItem = (item: GenerationItem) => {
    setSelectedId(item.id)
    setActiveJob(null)
    setPrompt(item.prompt)

    if (item.providerId) {
      selectProvider(item.providerId)
    }

    if (item.mode === 'image-to-image' || item.mode === 'image-to-video') {
      setReferenceMode(item.mode)
    }
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

    if (item.mode === 'image-to-image' || item.mode === 'image-to-video') {
      setReferenceMode(item.mode)
    }

    window.setTimeout(() => {
      void runWorkflow(item.prompt, item.providerId ?? 'runninghub')
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

    if (providerId === 'gemini' && referenceMode === 'image-to-video') {
      setReferenceMode('image-to-image')
      showToast('NanoBanana 暂不支持图生视频，已切换为图生图')
    }
  }

  const copyImageLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      showToast('图片链接已复制')
    } catch {
      showToast('复制失败，请打开图片后手动复制')
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
    showToast('参考图已添加，可选择图生图或图生视频')
  }

  const clearReferenceImage = () => {
    setReferenceImage((currentImage) => {
      if (currentImage) {
        URL.revokeObjectURL(currentImage.url)
      }

      return null
    })
  }

  const selectReferenceMode = (mode: ReferenceMode) => {
    if (!referenceImage) {
      showToast('先上传参考图，再选择图像工作流')
      return
    }

    if (activeProvider === 'gemini' && mode === 'image-to-video') {
      showToast('NanoBanana 当前不支持图生视频')
      return
    }

    setReferenceMode(mode)
  }

  const runWorkflow = async (promptOverride?: string, providerOverride?: ProviderId) => {
    const cleanPrompt = (promptOverride ?? prompt).trim()
    const providerId = providerOverride ?? activeProvider

    const configured =
      providerId === 'gemini'
        ? geminiAdapter.isConfigured(geminiSettings)
        : runningHubAdapter.isConfigured(runningHubSettings)

    if (!configured) {
      setSettingsProvider(providerId)
      setSettingsOpen(true)
      showSavedNotice(providerId === 'gemini' ? '请补全 NanoBanana 连接设置' : '请先填写 RunningHub API Key')
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
    const mode = imageInput ? referenceMode : 'text-to-image'

    if (providerId === 'gemini' && mode === 'image-to-video') {
      showToast('NanoBanana 当前不支持图生视频')
      return
    }

    const job: GenerationItem = {
      id: crypto.randomUUID(),
      title: makeTitle(cleanPrompt),
      prompt: cleanPrompt,
      providerId,
      mode,
      status: 'RUNNING',
      resultUrls: [],
      createdAt: new Date().toISOString(),
    }

    setIsGenerating(true)
    setActiveJob(job)

    let trackedJob = job

    try {
      if (imageInput) {
        showToast(providerId === 'gemini' ? '正在读取参考图' : '正在上传参考图到 RunningHub')
      }

      const submitData =
        providerId === 'gemini'
          ? await submitGeminiWorkflow(geminiSettings, cleanPrompt, mode, imageInput?.file)
          : await submitRunningHubWorkflow(runningHubSettings, cleanPrompt, mode, imageInput?.file)

      trackedJob = mergeProviderTask(job, submitData)
      setActiveJob(trackedJob)
      upsertHistory(trackedJob)

      if (providerId === 'runninghub') {
        if (!trackedJob.taskId) {
          throw new Error('提交成功，但 RunningHub 没有返回任务 ID。')
        }

        const completedJob = await pollRunningHubTask(trackedJob)
        setActiveJob(completedJob)
        upsertHistory(completedJob)
      }
    } catch (error) {
      const adapter = providerId === 'gemini' ? geminiAdapter : runningHubAdapter
      const failedJob: GenerationItem = {
        ...trackedJob,
        status: 'FAILED',
        errorMessage: getErrorMessage(adapter.normalizeError(error)),
      }
      setActiveJob(failedJob)
      upsertHistory(failedJob)
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
        <div className="aurora aurora-one" />
        <div className="aurora aurora-two" />
        <div className="grid-glow" />
      </div>

      <aside className={`sidebar ${sidebarOpen ? 'is-open' : 'is-collapsed'}`}>
        <div className="sidebar-top">
          <button
            className="icon-button sidebar-toggle"
            type="button"
            aria-label={sidebarOpen ? '收起侧边栏' : '展开侧边栏'}
            onClick={() => setSidebarOpen((open) => !open)}
          >
            {sidebarOpen ? '‹' : '›'}
          </button>
        </div>

        {sidebarOpen && (
          <>
            <button className="new-chat" type="button" onClick={startNewChat}>
              <span>＋</span>
              新对话
            </button>

            <section className="history-section">
              <div className="history-heading">
                <p className="section-label">历史创作</p>
                {history.length > 0 && (
                  <button type="button" onClick={clearHistory}>
                    清空
                  </button>
                )}
              </div>
              <div className="history-list">
                {history.length ? (
                  history.map((item) => (
                    <button
                      className={`history-item ${item.id === selectedId ? 'is-active' : ''}`}
                      type="button"
                      key={item.id}
                      onClick={() => selectHistoryItem(item)}
                    >
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
                  ))
                ) : (
                  <p className="empty-history">暂无历史</p>
                )}
              </div>
            </section>
          </>
        )}
      </aside>

      <section className="workspace">
        <header className="topbar">
          <button className="settings-button" type="button" onClick={() => setSettingsOpen(true)}>
            <span>⚙</span>
            设置
          </button>
        </header>

        <section className="conversation-panel">
          <div className="hero-copy">
            <p className="eyebrow">CREATIVE WORKSHOP</p>
            <h1>开始创作吧！</h1>
          </div>

          {displayJob && (
            <article className={`preview-card ${displayJob.status === 'FAILED' ? 'is-error' : ''}`}>
              <div className="preview-header">
                <div>
                  <p>{displayJob.title}</p>
                  <span>{displayJob.prompt || '等待输入创作描述'}</span>
                </div>
                <span>{formatStatus(displayJob.status)}</span>
              </div>

              {displayJob.status === 'SUCCESS' && displayJob.resultUrls.length > 0 ? (
                <div className={`result-grid ${displayJob.mode === 'image-to-video' ? 'has-video' : ''}`}>
                  {displayJob.resultUrls.map((url, index) => (
                    <figure className="result-image" key={`${displayJob.id}-${index}`}>
                      {isVideoResult(url, displayJob.mode) ? (
                        <video src={url} controls playsInline />
                      ) : (
                        <img src={url} alt={displayJob.prompt} />
                      )}
                      <figcaption>
                        <a href={url} target="_blank" rel="noreferrer">
                          {isVideoResult(url, displayJob.mode) ? '打开视频' : '打开图片'}
                        </a>
                      </figcaption>
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
                <button type="button" onClick={() => retryJob(displayJob)} disabled={isGenerating}>
                  重新生成
                </button>
                {displayJob.taskId && (
                  <button type="button" onClick={() => refreshJobResult(displayJob)} disabled={isGenerating}>
                    刷新结果
                  </button>
                )}
                {displayJob.resultUrls.map((url, index) => (
                  <span className="image-actions" key={url}>
                    <button type="button" onClick={() => copyImageLink(url)}>
                      复制链接{displayJob.resultUrls.length > 1 ? index + 1 : ''}
                    </button>
                    <a href={url} download target="_blank" rel="noreferrer">
                      下载{isVideoResult(url, displayJob.mode) ? '视频' : '图片'}
                      {displayJob.resultUrls.length > 1 ? index + 1 : ''}
                    </a>
                  </span>
                ))}
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
                ＋
              </button>
              {referenceImage ? (
                <span className="mode-switch" aria-label="选择参考图工作流">
                  <button
                    className={referenceMode === 'image-to-image' ? 'is-active' : ''}
                    type="button"
                    aria-pressed={referenceMode === 'image-to-image'}
                    onClick={() => selectReferenceMode('image-to-image')}
                  >
                    图生图
                  </button>
                  {activeProvider === 'runninghub' && (
                    <button
                      className={referenceMode === 'image-to-video' ? 'is-active' : ''}
                      type="button"
                      aria-pressed={referenceMode === 'image-to-video'}
                      onClick={() => selectReferenceMode('image-to-video')}
                    >
                      图生视频
                    </button>
                  )}
                </span>
              ) : (
                <button type="button">文生图</button>
              )}
              <label className="provider-picker">
                <span className="sr-only">创作平台</span>
                <select value={activeProvider} onChange={(event) => selectProvider(event.target.value as ProviderId)}>
                  <option value="runninghub">RunningHub</option>
                  <option value="gemini">NanoBanana</option>
                </select>
              </label>
              <button type="button">比例 自动</button>
              <button type="button">中文</button>
            </div>
            <div className="composer-actions">
              <span>{prompt.length}/2000</span>
              <button
                className="send-button"
                type="button"
                aria-label="生成内容"
                disabled={isGenerating}
                onClick={() => runWorkflow()}
              >
                {isGenerating ? '生成中' : '↑'}
              </button>
            </div>
          </div>
        </section>
      </section>

      <div
        className={`drawer-backdrop ${settingsOpen ? 'is-open' : ''}`}
        onClick={() => setSettingsOpen(false)}
        aria-hidden="true"
      />
      <aside className={`settings-drawer ${settingsOpen ? 'is-open' : ''}`} aria-label="平台连接设置">
        <div className="drawer-header">
          <div>
            <p>连接设置</p>
            <h2>{settingsProvider === 'gemini' ? 'NanoBanana' : 'RunningHub'}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="关闭设置" onClick={() => setSettingsOpen(false)}>
            ×
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
      {toastMessage && <div className="toast-message">{toastMessage}</div>}
    </main>
  )
}

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

async function submitGeminiWorkflow(
  settings: GeminiSettings,
  prompt: string,
  mode: GenerationMode,
  file?: File,
) {
  const media = file && geminiAdapter.uploadMedia ? [await geminiAdapter.uploadMedia(settings, file)] : undefined
  return geminiAdapter.submitTask(settings, { prompt, capability: mode, media })
}

async function submitRunningHubWorkflow(
  settings: RunningHubSettings,
  prompt: string,
  mode: GenerationMode,
  file?: File,
) {
  const media = file && runningHubAdapter.uploadMedia ? [await runningHubAdapter.uploadMedia(settings, file)] : undefined
  return runningHubAdapter.submitTask(settings, { prompt, capability: mode, media })
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

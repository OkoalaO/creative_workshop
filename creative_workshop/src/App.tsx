import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  defaultRunningHubSettings,
  extractResultUrls,
  queryTask,
  type RunningHubResponse,
  type RunningHubSettings,
  type RunningHubStatus,
  submitImageToImageTask,
  submitImageToVideoTask,
  submitTextToImageTask,
  uploadImage,
} from './providers/runninghub'
import './App.css'

type GenerationMode = 'text-to-image' | 'image-to-image' | 'image-to-video'
type ReferenceMode = Exclude<GenerationMode, 'text-to-image'>
type GenerationStatus = RunningHubStatus | 'PENDING_RESULT'

type GenerationItem = {
  id: string
  title: string
  prompt: string
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

const SETTINGS_KEY = 'cw-runninghub-settings'
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
  const [settings, setSettings] = useState<RunningHubSettings>(defaultRunningHubSettings)
  const [savedNotice, setSavedNotice] = useState('')
  const [history, setHistory] = useState<GenerationItem[]>([])
  const [activeJob, setActiveJob] = useState<GenerationItem | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [toastMessage, setToastMessage] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const savedSettings = window.localStorage.getItem(SETTINGS_KEY)
    if (savedSettings) {
      try {
        setSettings({ ...defaultRunningHubSettings, ...JSON.parse(savedSettings) })
      } catch {
        window.localStorage.removeItem(SETTINGS_KEY)
      }
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
  const isConnected = Boolean(settings.apiKey.trim())
  const maskedKey = settings.apiKey
    ? `${settings.apiKey.slice(0, 4)}••••••••${settings.apiKey.slice(-4)}`
    : '未连接'
  const activeMode: GenerationMode = referenceImage ? referenceMode : 'text-to-image'

  const saveSettings = () => {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    showSavedNotice('设置已保存到当前浏览器')
  }

  const saveHistory = (nextHistory: GenerationItem[]) => {
    setHistory(nextHistory)
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory))
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

    if (item.mode === 'image-to-image' || item.mode === 'image-to-video') {
      setReferenceMode(item.mode)
    }
  }

  const retryJob = (item: GenerationItem) => {
    setPrompt(item.prompt)
    setActiveJob(null)

    if ((item.mode === 'image-to-image' || item.mode === 'image-to-video') && !referenceImage) {
      showToast('重新生成需要先重新上传参考图')
      return
    }

    if (item.mode === 'image-to-image' || item.mode === 'image-to-video') {
      setReferenceMode(item.mode)
    }

    window.setTimeout(() => {
      void runWorkflow(item.prompt)
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

  const copyImageLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      showToast('图片链接已复制')
    } catch {
      showToast('复制失败，请打开图片后手动复制')
    }
  }

  const refreshJobResult = async (item: GenerationItem) => {
    if (!settings.apiKey.trim()) {
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
      const queryData = await queryTask(settings.apiKey.trim(), item.taskId)
      const refreshedJob = mergeQueryResult(item, queryData)

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

    setReferenceMode(mode)
  }

  const runWorkflow = async (promptOverride?: string) => {
    const cleanPrompt = (promptOverride ?? prompt).trim()

    if (!settings.apiKey.trim()) {
      setSettingsOpen(true)
      showSavedNotice('请先填写 RunningHub API Key')
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

    const job: GenerationItem = {
      id: crypto.randomUUID(),
      title: makeTitle(cleanPrompt),
      prompt: cleanPrompt,
      mode,
      status: 'RUNNING',
      resultUrls: [],
      createdAt: new Date().toISOString(),
    }

    setIsGenerating(true)
    setActiveJob(job)

    let trackedJob = job

    try {
      let submitData

      if (imageInput) {
        showToast('正在上传参考图到 RunningHub')
        const imageUrl = await uploadImage(settings.apiKey.trim(), imageInput.file)
        submitData =
          mode === 'image-to-video'
            ? await submitImageToVideoTask(settings, cleanPrompt, imageUrl)
            : await submitImageToImageTask(settings, cleanPrompt, imageUrl)
      } else {
        submitData = await submitTextToImageTask(settings, cleanPrompt)
      }

      if (!submitData.taskId) {
        throw new Error('提交成功，但 RunningHub 没有返回任务 ID。')
      }

      trackedJob = { ...job, taskId: submitData.taskId, status: submitData.status ?? 'RUNNING' }
      setActiveJob(trackedJob)
      upsertHistory(trackedJob)

      const completedJob = await pollRunningHubTask(trackedJob, settings.apiKey.trim())
      setActiveJob(completedJob)
      upsertHistory(completedJob)
    } catch (error) {
      const failedJob: GenerationItem = {
        ...trackedJob,
        status: 'FAILED',
        errorMessage: getErrorMessage(error),
      }
      setActiveJob(failedJob)
      upsertHistory(failedJob)
    } finally {
      setIsGenerating(false)
    }
  }

  const pollRunningHubTask = async (job: GenerationItem, apiKey: string): Promise<GenerationItem> => {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
      await wait(POLL_INTERVAL_MS)

      const queryData = await queryTask(apiKey, job.taskId)

      const nextStatus = queryData.status ?? 'RUNNING'
      const nextJob = { ...job, status: nextStatus }
      setActiveJob(nextJob)

      if (nextStatus === 'SUCCESS') {
        const resultUrls = extractResultUrls(queryData.results)

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
          {sidebarOpen && <span className="brand-mark">CW</span>}
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

          <div className="status-card">
            <div>
              <span className={`status-dot ${isConnected ? '' : 'is-muted'}`} />
              RunningHub · {isConnected ? '已连接' : '未连接'}
            </div>
            <span>{maskedKey}</span>
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
                  {displayJob.resultUrls.map((url) => (
                    <figure className="result-image" key={url}>
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
              <p className="expiry-note">RunningHub 返回的结果链接约 24 小时后可能失效，请及时下载。</p>
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
                  <button
                    className={referenceMode === 'image-to-video' ? 'is-active' : ''}
                    type="button"
                    aria-pressed={referenceMode === 'image-to-video'}
                    onClick={() => selectReferenceMode('image-to-video')}
                  >
                    图生视频
                  </button>
                </span>
              ) : (
                <button type="button">文生图</button>
              )}
              <button type="button">RunningHub</button>
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
      <aside className={`settings-drawer ${settingsOpen ? 'is-open' : ''}`} aria-label="RunningHub 设置">
        <div className="drawer-header">
          <div>
            <p>连接设置</p>
            <h2>RunningHub</h2>
          </div>
          <button className="icon-button" type="button" aria-label="关闭设置" onClick={() => setSettingsOpen(false)}>
            ×
          </button>
        </div>

        <label>
          API Key
          <span className={`key-state ${isConnected ? 'is-connected' : ''}`}>
            {isConnected ? '已连接，密钥只保存在当前浏览器' : '未连接'}
          </span>
          <input
            type="password"
            value={settings.apiKey}
            placeholder="粘贴你的 RunningHub API Key"
            onChange={(event) => setSettings({ ...settings, apiKey: event.target.value })}
          />
        </label>

        <button className="save-button" type="button" onClick={saveSettings}>
          保存设置
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

function mergeQueryResult(job: GenerationItem, queryData: RunningHubResponse): GenerationItem {
  const nextStatus = queryData.status ?? 'RUNNING'

  if (nextStatus === 'SUCCESS') {
    const resultUrls = extractResultUrls(queryData.results)

    return {
      ...job,
      status: 'SUCCESS',
      resultUrls,
      errorMessage: resultUrls.length ? undefined : '任务成功，但没有返回结果链接。',
    }
  }

  if (nextStatus === 'FAILED') {
    return {
      ...job,
      status: 'FAILED',
      errorMessage: queryData.errorMessage || 'RunningHub 任务生成失败。',
    }
  }

  return {
    ...job,
    status: 'PENDING_RESULT',
    errorMessage: 'RunningHub 仍在生成，可以稍后再次刷新结果。',
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
    return job.mode === 'image-to-video' ? 'RunningHub 正在生成视频，请稍等。' : 'RunningHub 正在生成图片，请稍等。'
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

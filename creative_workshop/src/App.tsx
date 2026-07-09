import { useEffect, useMemo, useState } from 'react'
import './App.css'

type RunningHubStatus = 'IDLE' | 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED'

type RunningHubResult = {
  url?: string
  nodeId?: string
  outputType?: string
  text?: string | null
}

type RunningHubResponse = {
  taskId?: string
  status?: RunningHubStatus
  errorCode?: string
  errorMessage?: string
  results?: RunningHubResult[] | null
}

type GenerationItem = {
  id: string
  title: string
  prompt: string
  status: RunningHubStatus
  taskId?: string
  resultUrls: string[]
  errorMessage?: string
  createdAt: string
}

type Settings = {
  apiKey: string
  workflowId: string
  instanceType: 'default' | 'plus'
  nodeTemplate: string
}

const SETTINGS_KEY = 'cw-runninghub-settings'
const HISTORY_KEY = 'cw-generation-history'
const POLL_INTERVAL_MS = 2500
const MAX_POLL_ATTEMPTS = 96

const defaultSettings: Settings = {
  apiKey: '',
  workflowId: '1997246493079834625',
  instanceType: 'default',
  nodeTemplate:
    '[\n  {\n    "nodeId": "6",\n    "fieldName": "text",\n    "fieldValue": "{{prompt}}"\n  }\n]',
}

function App() {
  const [prompt, setPrompt] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [selectedId, setSelectedId] = useState('')
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const [savedNotice, setSavedNotice] = useState('')
  const [history, setHistory] = useState<GenerationItem[]>([])
  const [activeJob, setActiveJob] = useState<GenerationItem | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)

  useEffect(() => {
    const savedSettings = window.localStorage.getItem(SETTINGS_KEY)
    if (savedSettings) {
      try {
        setSettings({ ...defaultSettings, ...JSON.parse(savedSettings) })
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

  const selectedHistory = useMemo(
    () => history.find((item) => item.id === selectedId) ?? history[0] ?? null,
    [history, selectedId],
  )

  const displayJob = activeJob ?? selectedHistory
  const maskedKey = settings.apiKey
    ? `${settings.apiKey.slice(0, 4)}••••••••${settings.apiKey.slice(-4)}`
    : '未连接'

  const saveSettings = () => {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    setSavedNotice('设置已保存到当前浏览器')
    window.setTimeout(() => setSavedNotice(''), 2400)
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
    setActiveJob(null)
    setSelectedId('')
  }

  const selectHistoryItem = (item: GenerationItem) => {
    setSelectedId(item.id)
    setActiveJob(null)
    setPrompt(item.prompt)
  }

  const buildNodeInfoList = () => {
    const template = settings.nodeTemplate.replaceAll('{{prompt}}', prompt.trim())
    return JSON.parse(template)
  }

  const runWorkflow = async () => {
    const cleanPrompt = prompt.trim()

    if (!settings.apiKey.trim()) {
      setSettingsOpen(true)
      setSavedNotice('请先填写 RunningHub API Key')
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

    let nodeInfoList: unknown
    try {
      nodeInfoList = buildNodeInfoList()
    } catch {
      setActiveJob({
        id: crypto.randomUUID(),
        title: '节点模板格式错误',
        prompt: cleanPrompt,
        status: 'FAILED',
        resultUrls: [],
        errorMessage: '内置节点模板不是有效 JSON，需要检查工作流参数映射。',
        createdAt: new Date().toISOString(),
      })
      return
    }

    const job: GenerationItem = {
      id: crypto.randomUUID(),
      title: makeTitle(cleanPrompt),
      prompt: cleanPrompt,
      status: 'RUNNING',
      resultUrls: [],
      createdAt: new Date().toISOString(),
    }

    setIsGenerating(true)
    setActiveJob(job)

    try {
      const submitResponse = await fetch(
        `https://www.runninghub.cn/openapi/v2/run/workflow/${settings.workflowId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${settings.apiKey.trim()}`,
          },
          body: JSON.stringify({
            addMetadata: true,
            nodeInfoList,
            instanceType: settings.instanceType,
            usePersonalQueue: 'false',
          }),
        },
      )

      const submitData = (await submitResponse.json()) as RunningHubResponse

      if (!submitResponse.ok || submitData.errorCode || !submitData.taskId) {
        throw new Error(submitData.errorMessage || `提交失败，HTTP ${submitResponse.status}`)
      }

      const runningJob = { ...job, taskId: submitData.taskId, status: submitData.status ?? 'RUNNING' }
      setActiveJob(runningJob)

      const completedJob = await pollRunningHubTask(runningJob, settings.apiKey.trim())
      setActiveJob(completedJob)
      upsertHistory(completedJob)
    } catch (error) {
      const failedJob: GenerationItem = {
        ...job,
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

      const queryResponse = await fetch('https://www.runninghub.cn/openapi/v2/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ taskId: job.taskId }),
      })

      const queryData = (await queryResponse.json()) as RunningHubResponse

      if (!queryResponse.ok || queryData.errorCode) {
        throw new Error(queryData.errorMessage || `查询失败，HTTP ${queryResponse.status}`)
      }

      const nextStatus = queryData.status ?? 'RUNNING'
      const nextJob = { ...job, status: nextStatus }
      setActiveJob(nextJob)

      if (nextStatus === 'SUCCESS') {
        const resultUrls = (queryData.results ?? [])
          .map((result) => result.url)
          .filter((url): url is string => Boolean(url))

        return {
          ...nextJob,
          resultUrls,
          errorMessage: resultUrls.length ? undefined : '任务成功，但没有返回图片链接。',
        }
      }

      if (nextStatus === 'FAILED') {
        throw new Error(queryData.errorMessage || 'RunningHub 任务生成失败。')
      }
    }

    throw new Error('等待时间过长，任务仍未完成。可以稍后在 RunningHub 查看任务结果。')
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
              <p className="section-label">历史创作</p>
              <div className="history-list">
                {history.length ? (
                  history.map((item) => (
                    <button
                      className={`history-item ${item.id === selectedId ? 'is-active' : ''}`}
                      type="button"
                      key={item.id}
                      onClick={() => selectHistoryItem(item)}
                    >
                      <span className="history-title">{item.title}</span>
                      <span className="history-meta">
                        {formatTime(item.createdAt)} · {formatStatus(item.status)}
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
              <span className={`status-dot ${settings.apiKey ? '' : 'is-muted'}`} />
              当前连接：RunningHub · {maskedKey}
            </div>
            <span>默认文生图工作流</span>
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
                <div className="result-grid">
                  {displayJob.resultUrls.map((url) => (
                    <figure className="result-image" key={url}>
                      <img src={url} alt={displayJob.prompt} />
                      <figcaption>
                        <a href={url} target="_blank" rel="noreferrer">
                          打开图片
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
              <p className="expiry-note">RunningHub 返回的图片链接约 24 小时后可能失效，请及时下载。</p>
            </article>
          )}
        </section>

        <section className="composer" aria-label="创作输入框">
          <textarea
            value={prompt}
            maxLength={2000}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="描述你的想法，或上传参考图。比如：生成一张国风少女海报，红色斗篷，雪景，电影感..."
          />
          <div className="composer-footer">
            <div className="composer-tools">
              <button className="round-tool" type="button" aria-label="上传参考图">
                ＋
              </button>
              <button type="button">文生图</button>
              <button type="button">RunningHub</button>
              <button type="button">比例 自动</button>
              <button type="button">中文</button>
            </div>
            <div className="composer-actions">
              <span>{prompt.length}/2000</span>
              <button
                className="send-button"
                type="button"
                aria-label="生成图片"
                disabled={isGenerating}
                onClick={runWorkflow}
              >
                {isGenerating ? '·' : '↑'}
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

function formatStatus(status: RunningHubStatus) {
  const statusMap: Record<RunningHubStatus, string> = {
    IDLE: '待开始',
    QUEUED: '排队中',
    RUNNING: '生成中',
    SUCCESS: '完成',
    FAILED: '失败',
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
    return 'RunningHub 正在生成图片，请稍等。'
  }

  return '准备开始生成。'
}

export default App

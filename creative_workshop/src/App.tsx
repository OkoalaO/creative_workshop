import { useEffect, useMemo, useState } from 'react'
import './App.css'

type HistoryItem = {
  id: string
  title: string
  prompt: string
  status: '完成' | '草稿' | '失败'
  createdAt: string
}

type Settings = {
  apiKey: string
  workflowId: string
  instanceType: 'default' | 'plus'
  nodeTemplate: string
}

const defaultSettings: Settings = {
  apiKey: '',
  workflowId: '1997246493079834625',
  instanceType: 'default',
  nodeTemplate:
    '[\n  {\n    "nodeId": "6",\n    "fieldName": "text",\n    "fieldValue": "{{prompt}}"\n  }\n]',
}

const starterHistory: HistoryItem[] = [
  {
    id: '1',
    title: '国风少女海报',
    prompt: '红色斗篷，雪景，电影感，竖版海报',
    status: '完成',
    createdAt: '今天',
  },
  {
    id: '2',
    title: '赛博猫咪封面',
    prompt: '霓虹灯光，赛博朋克猫，小红书封面',
    status: '草稿',
    createdAt: '今天',
  },
  {
    id: '3',
    title: '香水产品图',
    prompt: '黑色背景，高级商业摄影，水滴反光',
    status: '完成',
    createdAt: '最近',
  },
]

function App() {
  const [prompt, setPrompt] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [selectedId, setSelectedId] = useState('1')
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const [savedNotice, setSavedNotice] = useState('')

  useEffect(() => {
    const saved = window.localStorage.getItem('cw-runninghub-settings')
    if (saved) {
      try {
        setSettings({ ...defaultSettings, ...JSON.parse(saved) })
      } catch {
        window.localStorage.removeItem('cw-runninghub-settings')
      }
    }
  }, [])

  const selectedHistory = useMemo(
    () => starterHistory.find((item) => item.id === selectedId) ?? starterHistory[0],
    [selectedId],
  )

  const maskedKey = settings.apiKey
    ? `${settings.apiKey.slice(0, 4)}••••••••${settings.apiKey.slice(-4)}`
    : '未连接'

  const saveSettings = () => {
    window.localStorage.setItem('cw-runninghub-settings', JSON.stringify(settings))
    setSavedNotice('设置已保存到当前浏览器')
    window.setTimeout(() => setSavedNotice(''), 2400)
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
            <button className="new-chat" type="button">
              <span>＋</span>
              新对话
            </button>

            <section className="history-section">
              <p className="section-label">历史创作</p>
              <div className="history-list">
                {starterHistory.map((item) => (
                  <button
                    className={`history-item ${item.id === selectedId ? 'is-active' : ''}`}
                    type="button"
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <span className="history-title">{item.title}</span>
                    <span className="history-meta">
                      {item.createdAt} · {item.status}
                    </span>
                  </button>
                ))}
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
              <span className="status-dot" />
              当前连接：RunningHub · {maskedKey}
            </div>
            <span>默认文生图工作流</span>
          </div>

          <article className="preview-card">
            <div className="preview-header">
              <div>
                <p>{selectedHistory.title}</p>
                <span>{selectedHistory.prompt}</span>
              </div>
              <span>{selectedHistory.status}</span>
            </div>
            <div className="preview-grid">
              <div className="preview-tile tile-one" />
              <div className="preview-tile tile-two" />
              <div className="preview-tile tile-three" />
            </div>
            <p className="expiry-note">RunningHub 返回的图片链接约 24 小时后可能失效，请及时下载。</p>
          </article>
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
              <button className="send-button" type="button" aria-label="生成图片">
                ↑
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

export default App

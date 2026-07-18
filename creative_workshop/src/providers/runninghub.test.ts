import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildWorkflowPayload, defaultRunningHubSettings, submitWorkflowTask } from './runninghub'
import { builtInRunningHubWorkflows } from '../workflows/runninghub'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RunningHub provider', () => {
  it('maps prompt and reference image into the selected workflow nodes', () => {
    const workflow = builtInRunningHubWorkflows[1]
    const payload = buildWorkflowPayload(
      { ...defaultRunningHubSettings, workflow },
      '把裙子改成绿色',
      'https://example.com/input.png',
    )

    expect(payload.nodeInfoList).toEqual([
      { nodeId: '107', fieldName: 'image', fieldValue: 'https://example.com/input.png' },
      { nodeId: '223', fieldName: 'value', fieldValue: '把裙子改成绿色' },
    ])
  })

  it('submits to the selected workflow ID without a real network request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ taskId: 'task-1', status: 'RUNNING' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await submitWorkflowTask(
      { ...defaultRunningHubSettings, apiKey: 'test-key', workflow: builtInRunningHubWorkflows[0] },
      '雨天玻璃质感',
    )

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/run/workflow/1997246493079834625')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer test-key' })
    expect(JSON.parse(String(init.body))).toMatchObject({
      nodeInfoList: [{ nodeId: '6', fieldName: 'text', fieldValue: '雨天玻璃质感' }],
    })
  })

  it('blocks image workflows when no reference image is supplied', () => {
    expect(() =>
      buildWorkflowPayload(
        { ...defaultRunningHubSettings, workflow: builtInRunningHubWorkflows[2] },
        '镜头缓慢推进',
      ),
    ).toThrow('需要参考图')
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildNewApiGeminiUrl,
  buildOpenAiImagesUrl,
  defaultGeminiSettings,
  extractNativeGeminiOutputs,
  extractOpenAiImageOutputs,
  submitGeminiTask,
} from './gemini'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('NanoBanana provider', () => {
  it('builds encoded New API Gemini and OpenAI Images URLs', () => {
    expect(buildNewApiGeminiUrl('http://38.145.218.40:12001', '[YQ] gemini image')).toContain(
      '%5BYQ%5D%20gemini%20image:generateContent',
    )
    expect(buildOpenAiImagesUrl('https://example.com')).toBe('https://example.com/v1/images/generations')
  })

  it('normalizes native Gemini and OpenAI image outputs', () => {
    expect(
      extractNativeGeminiOutputs({
        candidates: [{ content: { parts: [{ inlineData: { data: 'abc', mimeType: 'image/webp' } }] } }],
      }),
    ).toEqual([{ type: 'image', url: 'data:image/webp;base64,abc', mimeType: 'image/webp' }])
    expect(extractOpenAiImageOutputs({ data: [{ b64_json: 'xyz' }] })).toEqual([
      { type: 'image', url: 'data:image/png;base64,xyz' },
    ])
  })

  it('infers image-to-image from media supplied by the app request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ inlineData: { data: 'result', mimeType: 'image/png' } }] } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await submitGeminiTask(
      {
        ...defaultGeminiSettings,
        apiKey: 'test-key',
        baseUrl: 'https://example.com',
        modelId: 'test-model',
        protocol: 'newapi-gemini',
      },
      {
        prompt: '改成蓝色',
        capability: 'image-to-image',
        media: [{ kind: 'inline', data: 'input', mimeType: 'image/png' }],
      },
    )

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body))
    expect(body.contents[0].parts).toEqual([
      { text: '改成蓝色' },
      { inlineData: { data: 'input', mimeType: 'image/png' } },
    ])
  })
})

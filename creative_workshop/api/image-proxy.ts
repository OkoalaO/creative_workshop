const DEFAULT_ALLOWED_HOSTS = ['38.145.218.40:12001']

type ProxyRequest = {
  targetUrl?: string
  authorization?: string
  googleApiKey?: string
  payload?: unknown
}

export const config = {
  maxDuration: 300,
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonError(405, '仅支持 POST 请求。', { Allow: 'POST' })
  }

  let input: ProxyRequest
  try {
    input = (await request.json()) as ProxyRequest
  } catch {
    return jsonError(400, '请求内容不是有效的 JSON。')
  }

  let target: URL
  try {
    target = new URL(input.targetUrl ?? '')
  } catch {
    return jsonError(400, '目标 API 地址无效。')
  }

  if (!isAllowedTarget(target)) {
    return jsonError(403, '该 API 地址暂未获得平台支持。')
  }

  if (!input.authorization && !input.googleApiKey) {
    return jsonError(400, '缺少 API 鉴权信息。')
  }

  const headers = new Headers({
    'Content-Type': 'application/json',
    Accept: 'application/json',
  })

  if (input.authorization) headers.set('Authorization', input.authorization)
  if (input.googleApiKey) headers.set('x-goog-api-key', input.googleApiKey)

  try {
    const upstream = await fetch(target, {
      method: 'POST',
      headers,
      body: JSON.stringify(input.payload ?? {}),
      redirect: 'error',
      signal: AbortSignal.timeout(290_000),
    })

    const responseHeaders = new Headers({
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
      'Cache-Control': 'no-store',
    })

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    })
  } catch (error) {
    const message = error instanceof Error && error.name === 'TimeoutError'
      ? '上游接口响应超时。'
      : '代理无法连接上游接口。'
    return jsonError(502, message)
  }
}

function isAllowedTarget(target: URL) {
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return false

  const allowedHosts = new Set([
    ...DEFAULT_ALLOWED_HOSTS,
    ...(process.env.IMAGE_PROXY_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  ])

  if (!allowedHosts.has(target.host.toLowerCase())) return false

  return /\/v1\/images\/generations$/.test(target.pathname)
    || /\/interactions$/.test(target.pathname)
    || /\/v1beta\/models\/[^/]+:generateContent$/.test(target.pathname)
}

function jsonError(status: number, message: string, extraHeaders?: HeadersInit) {
  return Response.json(
    { error: { message } },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        ...Object.fromEntries(new Headers(extraHeaders)),
      },
    },
  )
}

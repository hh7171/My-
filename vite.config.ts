import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { parseClothRgb } from './cloth-parser.ts'
import { createLibrary } from './library-server.ts'
import { acceptGarmentTitle, garmentNamePrompt } from './src/garment-name.ts'
import { ARK_IMAGE, ARK_NAME, ARK_TASK_SIZE, ARK_VIDEO, IMAGE_PROVIDER, OPENROUTER_TASKS, imageTask, maxGarments, maxReferences } from './src/model-config.ts'
import { CATEGORY_LABEL, type Category } from './src/types.ts'

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/images'
const ARK_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/plan/v3/images/generations'
const ARK_CHAT_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions'
const ARK_VIDEO_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks'

type ImageResponse = {
  error?: { message?: string; code?: number | string }
  data?: { b64_json?: string; url?: string; media_type?: string }[]
}

function readJson(req: IncomingMessage): Promise<{ task?: string; prompt?: string; images?: string[]; rgb?: string; image?: string; category?: string }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as { task?: string; prompt?: string; images?: string[]; rgb?: string })
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function sendText(res: ServerResponse, status: number, message: string) {
  res.statusCode = status
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.end(message)
}

function failureText(error: unknown): string {
  if (!(error instanceof Error)) return '图像模型没有连上'
  const cause = error.cause
  const code = cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string' ? cause.code : ''
  console.error('image upstream failed', code || error.message)
  if (error.message === 'fetch failed' || code === 'ENOTFOUND' || code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'EAI_AGAIN' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return '图像模型没有连上。请确认这台电脑能访问火山方舟，然后重试。'
  }
  return error.message || '图像模型没有连上'
}

async function openRouterImage(apiKey: string, task: 'avatar' | 'flatlay' | 'fitted-layer' | 'outfit', prompt: string, images: string[]) {
  const config = OPENROUTER_TASKS[task]
  return fetch(OPENROUTER_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      prompt,
      input_references: images.map((url) => ({ type: 'image_url', image_url: { url } })),
      ...config.parameters,
    }),
  })
}

async function arkImage(apiKey: string, task: 'avatar' | 'flatlay' | 'fitted-layer' | 'outfit', prompt: string, images: string[]) {
  return fetch(ARK_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: ARK_IMAGE.model,
      prompt,
      image: images.length === 1 ? images[0] : images,
      size: ARK_TASK_SIZE[task],
      response_format: 'b64_json',
      watermark: ARK_IMAGE.watermark,
    }),
  })
}

async function handleWear(apiKey: string, req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    sendText(res, 405, '只接受 POST')
    return
  }
  if (!apiKey) {
    const missing = IMAGE_PROVIDER === 'ark'
      ? '还没有设置火山方舟 API Key。请把 Agent Plan 的专属 Key 填进项目根目录 .env 的 ARK_API_KEY，保存后重新运行 npm run dev。'
      : '还没有设置 OpenRouter API Key。请在项目根目录的 .env 里填写 OPENROUTER_API_KEY，保存后重新运行 npm run dev。'
    sendText(res, 401, missing)
    return
  }
  try {
    const body = await readJson(req)
    const task = imageTask(typeof body.task === 'string' ? body.task : '')
    const images = Array.isArray(body.images) ? body.images.filter((item) => typeof item === 'string' && item.length > 0) : []
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
    if (!task) {
      sendText(res, 400, '没有这种生图步骤')
      return
    }
    if (!prompt || images.length === 0) {
      sendText(res, 400, '缺少提示词或参考图')
      return
    }
    if (images.length > maxReferences(task)) {
      const outfit = task === 'outfit' ? `基准图占 1 张，衣服请控制在 ${maxGarments()} 件以内。` : ''
      sendText(res, 400, `这次图太多了。${outfit}`)
      return
    }
    const upstream = IMAGE_PROVIDER === 'ark'
      ? await arkImage(apiKey, task, prompt, images)
      : await openRouterImage(apiKey, task, prompt, images)
    const payload = (await upstream.json()) as ImageResponse
    if (!upstream.ok || payload.error) {
      sendText(res, upstream.ok ? 502 : upstream.status, payload.error?.message || '没有生成图片')
      return
    }
    const image = payload.data?.find((item) => item.b64_json || item.url)
    if (image?.b64_json) {
      const bytes = Buffer.from(image.b64_json, 'base64')
      res.statusCode = 200
      res.setHeader('Content-Type', image.media_type || 'image/jpeg')
      res.end(bytes)
      return
    }
    if (!image?.url) {
      sendText(res, 502, '没有返回图片')
      return
    }
    const downloaded = await fetch(image.url)
    if (!downloaded.ok) {
      sendText(res, 502, '生成图下载失败')
      return
    }
    const bytes = Buffer.from(await downloaded.arrayBuffer())
    res.statusCode = 200
    res.setHeader('Content-Type', downloaded.headers.get('content-type') || 'image/jpeg')
    res.end(bytes)
  } catch (error) {
    sendText(res, 502, failureText(error))
  }
}

function libraryPlugin(): Plugin {
  const library = createLibrary(join(process.cwd(), 'data'))
  const handler = (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => {
    const url = req.url?.split('?')[0]
    if (url !== '/api/library' && url !== '/api/library/file' && url !== '/api/source' && url !== '/api/source/file') {
      next()
      return
    }
    void library.handle(req, res)
  }
  return {
    name: 'local-library',
    configureServer(server) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler)
    },
  }
}

function clothPlugin(): Plugin {
  const handler = (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => {
    const url = req.url?.split('?')[0]
    if (url !== '/api/cloth-mask') {
      next()
      return
    }
    void (async () => {
      if (req.method !== 'POST') {
        sendText(res, 405, '只接受 POST')
        return
      }
      try {
        const body = await readJson(req)
        const rgb = typeof body.rgb === 'string' ? Buffer.from(body.rgb, 'base64') : Buffer.alloc(0)
        const parsed = await parseClothRgb(rgb)
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ width: parsed.width, height: parsed.height, labels: parsed.labels.toString('base64') }))
      } catch (error) {
        sendText(res, 502, error instanceof Error ? error.message : '服饰分割没有跑起来，这次没有保存。')
      }
    })()
  }
  return {
    name: 'cloth-parser',
    configureServer(server) {
      return () => {
        server.middlewares.use(handler)
      }
    },
    configurePreviewServer(server) {
      return () => {
        server.middlewares.use(handler)
      }
    },
  }
}

type VideoTask = {
  id?: string
  status?: string
  error?: { message?: string }
  content?: { video_url?: string }
}

async function arkOutfitVideo(apiKey: string, image: string): Promise<Buffer> {
  const created = await fetch(ARK_VIDEO_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: ARK_VIDEO.model,
      content: [
        { type: 'text', text: ARK_VIDEO.prompt },
        { type: 'image_url', image_url: { url: image }, role: 'first_frame' },
      ],
      duration: ARK_VIDEO.duration,
      ratio: 'adaptive',
      resolution: ARK_VIDEO.resolution,
      generate_audio: false,
      watermark: false,
    }),
  })
  const started = (await created.json()) as VideoTask
  if (!created.ok || !started.id) throw new Error(started.error?.message || '展示视频没有开始')
  const deadline = Date.now() + 4 * 60 * 1000
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3000))
    const statusResponse = await fetch(`${ARK_VIDEO_ENDPOINT}/${started.id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    const status = (await statusResponse.json()) as VideoTask
    if (!statusResponse.ok) throw new Error(status.error?.message || '展示视频没有查到')
    if (status.status === 'succeeded') {
      const url = status.content?.video_url
      if (!url) throw new Error('展示视频没有地址')
      const file = await fetch(url)
      if (!file.ok) throw new Error('展示视频没有下载下来')
      return Buffer.from(await file.arrayBuffer())
    }
    if (status.status === 'failed' || status.status === 'cancelled' || status.status === 'expired') {
      throw new Error(status.error?.message || '展示视频没有做成')
    }
  }
  throw new Error('展示视频等太久了')
}

function isCategory(value: string): value is Category {
  return Object.prototype.hasOwnProperty.call(CATEGORY_LABEL, value)
}

async function handleGarmentName(apiKey: string, req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    sendText(res, 405, '只接受 POST')
    return
  }
  if (!apiKey) {
    sendText(res, 401, '还没有设置火山方舟 API Key。请把 Agent Plan 的专属 Key 填进项目根目录 .env 的 ARK_API_KEY，保存后重新运行 npm run dev。')
    return
  }
  try {
    const body = await readJson(req)
    const category = typeof body.category === 'string' ? body.category : ''
    const image = typeof body.image === 'string' ? body.image : ''
    if (!isCategory(category) || !image.startsWith('data:image/')) {
      sendText(res, 400, '缺少单品类别或照片')
      return
    }
    const label = CATEGORY_LABEL[category]
    const upstream = await fetch(ARK_CHAT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        model: ARK_NAME.model,
        thinking: { type: 'enabled' },
        reasoning_effort: 'low',
        max_tokens: 512,
        temperature: 0.3,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: image } },
              { type: 'text', text: garmentNamePrompt(label) },
            ],
          },
        ],
      }),
    })
    const payload = (await upstream.json()) as {
      error?: { message?: string }
      choices?: { message?: { content?: string | null } }[]
    }
    if (!upstream.ok) {
      const message = payload.error?.message || '这次没有起出名字'
      console.error('garment name upstream', upstream.status, message.slice(0, 180))
      sendText(res, 502, '这次没有起出名字')
      return
    }
    const content = payload.choices?.[0]?.message?.content ?? ''
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ title: acceptGarmentTitle(content, label) }))
  } catch (error) {
    console.error('garment name failed', error instanceof Error ? error.message : error)
    sendText(res, 502, '这次没有起出名字')
  }
}

async function handleWearVideo(apiKey: string, req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    sendText(res, 405, '只接受 POST')
    return
  }
  if (!apiKey) {
    sendText(res, 401, '还没有设置火山方舟 API Key。请把 Agent Plan 的专属 Key 填进项目根目录 .env 的 ARK_API_KEY，保存后重新运行 npm run dev。')
    return
  }
  try {
    const body = await readJson(req)
    const image = typeof body.image === 'string' ? body.image : ''
    if (!image.startsWith('data:image/')) {
      sendText(res, 400, '缺少全身照')
      return
    }
    const bytes = await arkOutfitVideo(apiKey, image)
    res.statusCode = 200
    res.setHeader('Content-Type', 'video/mp4')
    res.end(bytes)
  } catch (error) {
    sendText(res, 502, error instanceof Error ? error.message : '展示视频没有做成')
  }
}

function wanPlugin(apiKey: string): Plugin {
  const handler = (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => {
    const url = req.url?.split('?')[0]
    if (url === '/api/wear-video') {
      void handleWearVideo(apiKey, req, res)
      return
    }
    if (url === '/api/garment-name') {
      void handleGarmentName(apiKey, req, res)
      return
    }
    if (url !== '/api/wear') {
      next()
      return
    }
    void handleWear(apiKey, req, res)
  }
  return {
    name: 'wan-wear',
    configureServer(server) {
      return () => {
        server.middlewares.use(handler)
      }
    },
    configurePreviewServer(server) {
      return () => {
        server.middlewares.use(handler)
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), libraryPlugin(), clothPlugin(), wanPlugin((IMAGE_PROVIDER === 'ark' ? env.ARK_API_KEY : env.OPENROUTER_API_KEY) || '')],
    server: {
      watch: {
        ignored: ['**/models/**'],
      },
    },
  }
})

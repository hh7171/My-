/** 四次生图的模型配置。当前走火山方舟，OpenRouter 的模型保留在下面。 */

export type ImageTaskId = 'avatar' | 'flatlay' | 'fitted-layer' | 'outfit'
export type ImageProviderId = 'ark' | 'openrouter'

type OpenRouterParameters = {
  aspect_ratio: '1:1' | '2:3'
  resolution?: '1K'
  quality?: 'high'
  background?: 'transparent' | 'opaque'
  n: 1
}

export type OpenRouterTask = {
  id: ImageTaskId
  model: string
  maxReferences: number
  parameters: OpenRouterParameters
}

const OUTFIT_GARMENT_CAP = 8

export const IMAGE_PROVIDER: ImageProviderId = 'ark'

export const ARK_IMAGE = {
  // Agent Plan 的 Seedream 5.0 pro。参考图最多 10 张，不支持组图参数。
  model: 'doubao-seedream-5.0-pro',
  maxReferences: 10,
  watermark: false,
}

export const ARK_VIDEO = {
  model: 'doubao-seedance-2.5',
  duration: 5,
  resolution: '720p',
  prompt: '人物穿着这身衣服自然地动起来，把全身穿搭展示清楚。保持图中的脸、衣服、鞋子和背景。不要换装，不要加文字，不要说话。',
}

export const ARK_TASK_SIZE: Record<ImageTaskId, string> = {
  avatar: '1664x2496',
  flatlay: '2048x2048',
  'fitted-layer': '1664x2496',
  outfit: '1728x2304',
}

export const OPENROUTER_TASKS: Record<ImageTaskId, OpenRouterTask> = {
  avatar: {
    id: 'avatar',
    model: 'google/gemini-nano-banana-2.1',
    maxReferences: 2,
    parameters: { aspect_ratio: '2:3', resolution: '1K', n: 1 },
  },
  flatlay: {
    id: 'flatlay',
    model: 'openai/gpt-image-2.5-sunburst',
    maxReferences: 1,
    parameters: { aspect_ratio: '1:1', quality: 'high', background: 'opaque', n: 1 },
  },
  'fitted-layer': {
    id: 'fitted-layer',
    model: 'google/gemini-nano-banana-2.1',
    maxReferences: 2,
    parameters: { aspect_ratio: '2:3', resolution: '1K', n: 1 },
  },
  outfit: {
    id: 'outfit',
    model: 'google/gemini-nano-banana-2.1',
    maxReferences: 14,
    parameters: { aspect_ratio: '2:3', resolution: '1K', n: 1 },
  },
}

export function imageTask(id: string): ImageTaskId | null {
  if (id === 'avatar' || id === 'flatlay' || id === 'fitted-layer' || id === 'outfit') return id
  return null
}

export function maxReferences(task: ImageTaskId): number {
  return IMAGE_PROVIDER === 'ark' ? ARK_IMAGE.maxReferences : OPENROUTER_TASKS[task].maxReferences
}

export function maxGarments(): number {
  return Math.min(OUTFIT_GARMENT_CAP, maxReferences('outfit') - 1)
}

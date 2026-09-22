/**
 * NSFW 网关：策略解析 + 出站媒体处理编排。
 *
 * 策略模型：
 * - 平台三态 off / full / smart（简洁模式 platformMode 表；高级模式 platformPolicyAdvanced 覆盖优先）
 * - 配置了审核 Provider → smart 优先于 full（全量混淆自动失效）
 * - smart：图片逐一送审，视频仅封面送审；命中才混淆/遮蔽
 * - full：无条件按命中处理
 * - fail-closed：审核异常按命中（见 moderation/index.ts）
 *
 * 动作（全局或平台覆盖）：
 * - imageAction: scramble（混淆图+token）| link（只发链接文字）| drop（不发送）
 * - videoAction: redeem（暂存+私聊凭 token 取）| link（发原链接文字）| drop
 */
import type { ParserRuntimeLike } from '@sns-parse/core'
import { debugLog, logger } from '@sns-parse/core'
import { createProvider, withFailClosed } from './moderation'
import type { ModerationProvider } from './moderation'
import { getFerret, scrambleImage } from './scramble'
import { videoVault } from './vault'
import type { ImageOutcome, MediaKind, VideoOutcome } from '@sns-parse/core'

// 类型已上移至 core/extensions（扩展契约），此处 re-export 保持既有引用兼容
export type { ImageOutcome, MediaKind, VideoOutcome } from '@sns-parse/core'

export type PlatformMode = 'off' | 'full' | 'smart'
export type ImageAction = 'scramble' | 'link' | 'drop'
export type VideoAction = 'redeem' | 'link' | 'drop'

export interface ResolvedPolicy {
  mode: PlatformMode
  imageAction: ImageAction
  videoAction: VideoAction
}

interface AdvancedPolicyEntry {
  platform: string
  mode?: PlatformMode
  imageAction?: ImageAction
  videoAction?: VideoAction
}

/** provider 缓存（WeakMap per runtime，配置变化随插件重载自然重建） */
const providerCache = new class {
  private map = new WeakMap<object, ModerationProvider | null>()
  get(rt: ParserRuntimeLike): ModerationProvider | null {
    if (!this.map.has(rt.ctx)) this.map.set(rt.ctx, buildProvider(rt))
    return this.map.get(rt.ctx) ?? null
  }
}()

function buildProvider(rt: ParserRuntimeLike): ModerationProvider | null {
  const conf = rt.config.nsfwModeration
  if (!conf) return null
  const raw = createProvider(conf as any, rt.http)
  return raw ? withFailClosed(raw) : null
}

export function getModerationProvider(rt: ParserRuntimeLike): ModerationProvider | null {
  return providerCache.get(rt)
}

/** 解析平台最终策略：高级显式覆盖 > 平台级显式（inherit 跟随全局）> 全局一刀切；
 *  配置审核 Provider 时，非高级显式的 full 自动转 smart（高级模式显式 full 视为专家意图，保留一刀切） */
export function resolvePolicy(rt: ParserRuntimeLike, platform: string): ResolvedPolicy {
  const nsfw = rt.config.nsfwPolicy || {}
  const platformVal = rt.config.nsfwPlatformMode?.[platform]
  const globalMode = rt.config.nsfwGlobalMode || 'off'
  let mode: PlatformMode = platformVal && platformVal !== 'inherit' ? platformVal : globalMode
  const policy: ResolvedPolicy = {
    mode,
    imageAction: nsfw.imageAction || 'scramble',
    videoAction: nsfw.videoAction || 'redeem',
  }
  let advancedFull = false
  if (rt.config.nsfwAdvancedPolicy) {
    const adv: AdvancedPolicyEntry | undefined = (rt.config.nsfwPlatformPolicyAdvanced || []).find((p: any) => p.platform === platform)
    if (adv) {
      if (adv.mode) {
        policy.mode = adv.mode
        advancedFull = adv.mode === 'full'
      }
      if (adv.imageAction) policy.imageAction = adv.imageAction
      if (adv.videoAction) policy.videoAction = adv.videoAction
    }
  }
  if (policy.mode === 'full' && getModerationProvider(rt) && !advancedFull) policy.mode = 'smart'
  return policy
}

/** 审核判定单图（smart 模式内部使用；含缓存） */
async function moderateImage(rt: ParserRuntimeLike, url: string): Promise<boolean> {
  const provider = getModerationProvider(rt)
  if (!provider) return false
  try {
    const res = await rt.http.get(url, { responseType: 'arraybuffer', timeout: 30000 })
    const result = await provider.check({ url, buffer: Buffer.from(res.data) })
    debugLog(`内容审核 ${result.nsfw ? '命中' : '通过'}（${result.detail || result.label || 'clean'}）: ${url.slice(0, 60)}`)
    return result.nsfw
  } catch (e: any) {
    logger.warn(`送审图片下载失败（fail-closed 按命中）: ${e?.message || e}`)
    return true
  }
}

/** 处理单张出站图片 */
export async function processImage(rt: ParserRuntimeLike, platform: string, url: string, kind: MediaKind): Promise<ImageOutcome> {
  if (!url) return { kind: 'drop' }
  const policy = resolvePolicy(rt, platform)
  // 头像/音乐封面默认跳过（scrambleAvatar 仅放开头像）
  if (kind === 'music-cover') return { kind: 'raw', url }
  if (kind === 'avatar' && !rt.config.nsfwPolicy?.scrambleAvatar) return { kind: 'raw', url }

  if (policy.mode === 'off') return { kind: 'raw', url }

  let hit = policy.mode === 'full'
  if (policy.mode === 'smart') hit = await moderateImage(rt, url)
  if (!hit) return { kind: 'raw', url }

  logger.info(`图片命中内容安全策略，动作=${policy.imageAction}（${kind}）: ${url.slice(0, 60)}`)
  if (policy.imageAction === 'drop') return { kind: 'drop' }
  if (policy.imageAction === 'link') return { kind: 'link', url }
  const s = await scrambleImage(rt, url)
  if (!s.ok) return { kind: 'link', url }
  return { kind: 'scrambled', buffer: s.buffer, token: s.token }
}

/**
 * 处理合并图（同源切图合一后的成品 buffer）：
 * - off → 直发合并图；smart 且合并图送审通过 → 直发
 * - smart 命中 / full / 审核异常（fail-closed）→ 返回 null，调用方回退逐张走 processImage
 */
export async function processMergedImage(rt: ParserRuntimeLike, platform: string, buffer: Buffer, refUrl: string): Promise<ImageOutcome | null> {
  const policy = resolvePolicy(rt, platform)
  if (policy.mode === 'off') return { kind: 'raw', buffer }
  if (policy.mode === 'full') return null
  const provider = getModerationProvider(rt)
  if (!provider) return { kind: 'raw', buffer }
  try {
    const result = await provider.check({ url: refUrl, buffer })
    debugLog(`合并图审核 ${result.nsfw ? '命中' : '通过'}（${result.detail || result.label || 'clean'}）: ${refUrl.slice(0, 60)}`)
    return result.nsfw ? null : { kind: 'raw', buffer }
  } catch {
    return null
  }
}

/** 处理出站视频（封面送审判定；命中后按 videoAction 处置） */
export async function processVideo(rt: ParserRuntimeLike, platform: string, videoUrl: string, coverUrl: string, meta: { title?: string; author?: string; requesterId: string }): Promise<VideoOutcome> {
  const policy = resolvePolicy(rt, platform)
  if (policy.mode === 'off') return { kind: 'raw', url: videoUrl }

  let hit = policy.mode === 'full'
  if (policy.mode === 'smart' && coverUrl) hit = await moderateImage(rt, coverUrl)

  if (!hit) return { kind: 'raw', url: videoUrl }

  logger.info(`视频命中内容安全策略，动作=${policy.videoAction}: ${videoUrl.slice(0, 60)}`)
  if (policy.videoAction === 'drop') return { kind: 'drop' }
  if (policy.videoAction === 'link') return { kind: 'link', url: videoUrl }

  // redeem：尝试下载缓存（<=maxItemMB），超限/失败降级 link
  // X 媒体 CDN (video.twimg.com/pbs.twimg.com) 需要浏览器级 UA + Referer 才不会 403
  const maxBytes = (videoVault as any).conf.maxItemMB * 1048576
  const CHROME_UA_V = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  try {
    const res = await rt.http.get(videoUrl, {
      responseType: 'arraybuffer',
      timeout: 120000,
      headers: {
        'User-Agent': CHROME_UA_V,
        'Referer': 'https://twitter.com/',
      },
    })
    const buffer = Buffer.from(res.data)
    if (buffer.length > maxBytes) {
      logger.warn(`受限视频 ${videoUrl} 体积 ${(buffer.length / 1048576).toFixed(1)}MB 超限 ${(maxBytes / 1048576).toFixed(0)}MB，降级发链接`)
      return { kind: 'link', url: videoUrl }
    }
    const sizeMB = +(buffer.length / 1048576).toFixed(1)
    const token = videoVault.put({
      requesterId: meta.requesterId,
      buffer,
      expiresAt: Date.now() + (videoVault as any).conf.ttlMinutes * 60000,
      meta: { title: meta.title, author: meta.author, platform, sizeMB },
    })
    logger.info(`受限视频已暂存 ${sizeMB}MB（token=${token.slice(0, 8)}…，绑定请求者 ${meta.requesterId}）`)
    return { kind: 'card', token }
  } catch (e: any) {
      logger.warn(`受限视频暂存失败（降级发链接文字）: ${e?.message || e}`)
    return { kind: 'link', url: videoUrl }
  }
}

/** 能力状态（供启动日志） */
export function nsfwCapability(rt: ParserRuntimeLike): { ferret: boolean; moderation: string | null } {
  return {
    ferret: !!getFerret(rt),
    moderation: getModerationProvider(rt)?.name || null,
  }
}

/**
 * ferret-transform 服务封装：能力探测、图片混淆、token 生成。
 *
 * 服务由 koishi-plugin-ferret-transform-image (>=0.0.4) 提供，通过
 * inject optional 声明，运行时探测（热重载自动生效/失效）。
 * 算法/token 协议由该服务保证，本插件不重复实现。
 */
import { randomBytes } from 'crypto'
import type { ParserRuntimeLike } from '@sns-parse/core'
import { logger } from '@sns-parse/core'

/** ferret-transform 服务调用面（与 0.0.4 的 service.ts 对齐；仅类型，无运行时依赖） */
export interface FerretTransformService {
  scramble(input: string | Buffer | Uint8Array, options?: { blockSize?: number; seed?: number; outputFormat?: 'png' | 'webp' | 'jpeg' }): Promise<Buffer>
  descramble(input: string | Buffer | Uint8Array, options?: { blockSize?: number; seed?: number }): Promise<Buffer>
  encodeToken(value: string): string
  decodeToken(token: string): string
  seedFrom(value: string): number
}

export function getFerret(rt: ParserRuntimeLike): FerretTransformService | null {
  return (rt.host.getService?.<FerretTransformService>('ferret-transform')) ?? null
}

/** 生成与 ferret 命令路径兼容的随机 token 及其对应 seed */
export function makeScrambleToken(service: FerretTransformService): { token: string; seed: number } {
  const source = randomBytes(16).toString('hex')
  return { token: service.encodeToken(source), seed: service.seedFrom(source) }
}

export interface ScrambleOutcome {
  ok: boolean
  buffer?: Buffer
  token?: string
  reason?: 'service-unavailable' | 'download-failed' | 'transform-failed'
}

/**
 * 下载并混淆一张图片。失败时返回 ok:false（调用方降级为发链接文字，
 * 不把可能的 NSFW 原图直接放出）。
 */
export async function scrambleImage(rt: ParserRuntimeLike, url: string): Promise<ScrambleOutcome> {
  const service = getFerret(rt)
  if (!service) return { ok: false, reason: 'service-unavailable' }
  try {
    const res = await rt.http.get(url, { responseType: 'arraybuffer', timeout: 30000 })
    const buffer = Buffer.from(res.data)
    const { token, seed } = makeScrambleToken(service)
    const scrambled = await service.scramble(buffer, { seed })
    return { ok: true, buffer: scrambled, token }
  } catch (e: any) {
    logger.warn(`图片混淆失败（${url.slice(0, 80)}）: ${e?.message || e}`)
    return { ok: false, reason: 'transform-failed' }
  }
}

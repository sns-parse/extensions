/**
 * 视频转 GIF（推文动图用）。
 *
 * ffmpeg 管道两遍法（palettegen + paletteuse），不落盘。
 * ffmpeg 不可用 / 转换失败 / 下载失败 → 返回 null，调用方回退发送原视频。
 */
import { spawn } from 'child_process'
import type { ParserRuntimeLike } from '@sns-parse/core'
import { debugLog, logger } from '@sns-parse/core'

export interface GifOptions {
  maxWidth: number
  fps: number
  maxDurationSec: number
}

let ffmpegMissingWarned = false

/**
 * ffmpeg 路径解析：内置静态二进制（optionalDependency ffmpeg-static，随插件自动安装）
 * → 系统 PATH。解析结果记忆化，来源记入 debug 日志。
 */
let resolvedFfmpeg: string | null = null
export function resolveFfmpeg(): string {
  if (resolvedFfmpeg !== null) return resolvedFfmpeg
  try {
    const p = require('ffmpeg-static')
    resolvedFfmpeg = typeof p === 'string' && p ? p : 'ffmpeg'
    debugLog(`ffmpeg 解析：内置静态二进制 ${resolvedFfmpeg}`)
  } catch {
    resolvedFfmpeg = 'ffmpeg'
    debugLog('ffmpeg 解析：未安装 ffmpeg-static（--no-optional 安装？），回退系统 PATH')
  }
  return resolvedFfmpeg
}

/** 生成 ffmpeg 滤镜串（导出供测试） */
export function gifFilter(width: number, fps: number): string {
  const w = Math.max(120, Math.min(1080, Math.round(width)))
  const f = Math.max(5, Math.min(30, Math.round(fps)))
  return `fps=${f},scale=${w}:-2:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer`
}

/** 裁剪实际转换时长：动图时长与上限取小；未知时长用上限 */
export function gifDuration(durationSec: number, maxDurationSec: number): number {
  const max = Math.max(1, Math.min(60, maxDurationSec))
  if (!durationSec || durationSec <= 0) return max
  return Math.max(1, Math.min(max, Math.round(durationSec)))
}

function runFfmpeg(input: Buffer, vf: string, durationSec: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const child = spawn(resolveFfmpeg(), [
      '-hide_banner', '-loglevel', 'error',
      '-i', 'pipe:0',
      '-t', String(durationSec),
      '-vf', vf,
      '-f', 'gif', 'pipe:1',
    ])
    const out: Buffer[] = []
    let err = ''
    child.stdout.on('data', (d: Buffer) => out.push(d))
    child.stderr.on('data', (d: Buffer) => { err += d.toString() })
    child.on('error', (e) => {
      if (!ffmpegMissingWarned) {
        ffmpegMissingWarned = true
        logger.warn(`GIF 转换需要 ffmpeg，但二进制不可用（动图将回退为视频发送）：${e.message}。请安装 optionalDependency ffmpeg-static，或在 PATH 中提供 ffmpeg。`)
      }
      resolve(null)
    })
    child.on('close', (code) => {
      if (code === 0 && out.length) {
        const gif = Buffer.concat(out)
        logger.info(`动图已转 GIF 发送：${Math.round(gif.length / 1024)}KB（源视频 ${Math.round(input.length / 1024)}KB）`)
        resolve(gif)
      } else {
        logger.info(`动图转 GIF 失败，回退发送原视频（ffmpeg 退出码 ${code}${err ? '：' + err.slice(0, 120) : ''}）`)
        resolve(null)
      }
    })
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}

/** 下载视频并转 GIF；任何失败返回 null */
export async function mp4ToGif(rt: ParserRuntimeLike, url: string, durationSec: number, opts: GifOptions): Promise<Buffer | null> {
  try {
    // X 媒体 CDN (video.twimg.com) 需要浏览器级 UA + Referer 才不会 403（与 vault 下载一致）
    const res = await rt.http.get(url, {
      responseType: 'arraybuffer',
      timeout: Math.min(rt.config.timeout || 60000, 120000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://twitter.com/',
      },
    })
    const input = Buffer.from(res.data)
    if (!input.length) return null
    return await runFfmpeg(input, gifFilter(opts.maxWidth, opts.fps), gifDuration(durationSec, opts.maxDurationSec))
  } catch (e: any) {
    logger.info(`动图 GIF 转换跳过（源视频下载失败，回退发送原视频）：${e?.message || e}`)
    return null
  }
}

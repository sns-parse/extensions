/**
 * @sns-parse/extensions 公共出口。
 *
 * 提供 core 契约 VideoParserExtensions 的默认实现装配：
 * NSFW(审核/混淆/暂存) + 同源合并 + 翻译 + GIF。
 */
import type { VideoParserExtensions } from '@sns-parse/core'
import { processImage, processVideo, processMergedImage, nsfwCapability } from './nsfw/gate'
import { mergeImages } from './merge'
import { mp4ToGif } from './gif'
import { translateText } from './translate'

/** 组装默认扩展实现（宿主可用自己的实现按需覆盖） */
export function createDefaultExtensions(): VideoParserExtensions {
  return {
    mergeImages,
    processImage,
    processVideo,
    processMergedImage,
    mp4ToGif,
    translate: translateText,
    capability: nsfwCapability,
  }
}

export * from './nsfw/gate'
export * from './nsfw/scramble'
export * from './nsfw/vault'
export * from './nsfw/moderation'
export { mergeImages } from './merge'
export { mp4ToGif, resolveFfmpeg, gifFilter, gifDuration } from './gif'
export { translateText, shouldSkipTranslate, langName } from './translate'
export { probeImageSize } from './image-size'
export type { ImageSize } from './image-size'

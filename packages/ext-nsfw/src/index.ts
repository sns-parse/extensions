/**
 * @sns-parse/ext-nsfw：内容安全（审核/图片混淆/受限视频暂存）。
 */
import { processImage, processVideo, processMergedImage, nsfwCapability } from './gate'

export * from './gate'
export * from './scramble'
export * from './vault'
export * from './moderation'

/** 组装为 core 扩展片段 */
export function nsfwExtension() {
  return { processImage, processVideo, processMergedImage, capability: nsfwCapability }
}

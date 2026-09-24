/**
 * @sns-parse/ext-nsfw：内容安全（审核/图片混淆/受限视频暂存）。
 * 经 WorkflowExtension.setup(hooks) 注入 media.* 阶段（替换基线直通）。
 */
import { processImage, processVideo, processMergedImage, nsfwCapability } from './gate'
import { nsfwConfigContribution } from './config'
import type { WorkflowExtension } from '@sns-parse/core'

export * from './gate'
export * from './scramble'
export * from './vault'
export * from './moderation'
export * from './moderation/cache'
export { nsfwConfigContribution } from './config'

/** 组装为 core 扩展片段（钩子注入） */
export function nsfwExtension(): WorkflowExtension {
  return {
    name: 'ext-nsfw',
    configContribution: nsfwConfigContribution,
    capability: (rt) => nsfwCapability(rt),
    setup(hooks) {
      hooks.replace('media.image', (input, rt) => processImage(rt, input.platform, input.url, input.kind))
      hooks.replace('media.video', (input, rt) => processVideo(rt, input.platform, input.videoUrl, input.coverUrl, input.meta))
      hooks.replace('media.merged', (input, rt) => processMergedImage(rt, input.platform, input.buffer, input.refUrl))
    },
  }
}

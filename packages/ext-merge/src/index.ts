/**
 * @sns-parse/ext-merge：同源切图内容识别合并（合并实现归属本包）。
 * 经 WorkflowExtension.setup(hooks) 注入 merge 阶段（替换基线不合并）。
 * 灰度探测 probeImageSize 等共享工具来自 @sns-parse/core；ffmpeg 解析来自 ext-gif。
 */
import { mergeImages } from './merge'
import type { WorkflowExtension } from '@sns-parse/core'

export {
  mergeImages, candidateLayouts, verifyLayout, detectMergeLayout, pickMergeLayout,
  xstackLayout, buildMergeFilter,
} from './merge'
export type { MergeLayout, SeamVerdict } from './merge'
export { probeImageSize } from '@sns-parse/core'
export type { ImageSize } from '@sns-parse/core'

/** 装配为 core 扩展碎片（钩子注入） */
export function mergeExtension(): WorkflowExtension {
  return {
    name: 'ext-merge',
    setup(hooks) {
      hooks.replace('merge', (input, rt) => mergeImages(rt, input.urls))
    },
  }
}

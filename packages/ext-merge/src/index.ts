/**
 * @sns-parse/ext-merge：同源切图内容识别合并（合并实现归属本包）。
 * 经 WorkflowExtension.setup(hooks) 注入 merge 阶段（替换基线不合并）。
 * 灰度探测 probeImageSize 等共享工具来自 @sns-parse/core；ffmpeg 解析来自 ext-gif。
 */
import { mergeImages } from './merge'
import type { WorkflowExtension, MergeInput } from '@sns-parse/core'
import type { ParserRuntimeLike } from '@sns-parse/core'

export {
  mergeImages, candidateLayouts, verifyLayout, detectMergeLayout, pickMergeLayout,
  pickMergeLayoutOrdered, bestStripOrder, partitionMerge,
  xstackLayout, buildMergeFilter,
} from './merge'
export type { MergeLayout, SeamVerdict, MergeStageResult, MergeGroupResult, MergePartition, MergePartitionGroup, PickedLayoutOrdered } from './merge'
export { probeImageSize } from '@sns-parse/core'
export type { ImageSize } from '@sns-parse/core'

/** 装配为 core 扩展碎片（钩子注入）。
 *  注意：merge 阶段返回分组契约（{ groups, leftoverUrls }，core ≥ 0.6.0-alpha.5）；
 *  这里对旧版 core 类型声明做窄转换（运行时形态才是契约），保证与新旧 core 均可装配。 */
export function mergeExtension(): WorkflowExtension {
  return {
    name: 'ext-merge',
    setup(hooks) {
      hooks.replace('merge', ((input: MergeInput, rt: ParserRuntimeLike) => mergeImages(rt, input.urls)) as any)
    },
  }
}

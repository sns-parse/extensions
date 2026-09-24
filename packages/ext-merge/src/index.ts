/**
 * @sns-parse/ext-merge：同源切图内容识别合并。
 * 实现来自 @sns-parse/core（utils/merge + utils/image-size）——本包是碎片化
 * 安装单元与扩展装配入口，不再持有实现副本（修复合并逻辑只需更新 core）。
 */
import { mergeImages } from '@sns-parse/core'

export {
  mergeImages, candidateLayouts, verifyLayout, detectMergeLayout,
  xstackLayout, buildMergeFilter,
} from '@sns-parse/core'
export type { MergeLayout } from '@sns-parse/core'
export { probeImageSize } from '@sns-parse/core'
export type { ImageSize } from '@sns-parse/core'

/** 装配为 core 扩展碎片 */
export function mergeExtension() {
  return { mergeImages }
}

/**
 * @sns-parse/ext-merge：同源切图纯内容识别与合并（依赖 ffmpeg，经 ext-gif 解析）。
 */
import { mergeImages } from './merge'

export {
  mergeImages, candidateLayouts, verifyLayout, detectMergeLayout,
  xstackLayout, buildMergeFilter,
} from './merge'
export type { MergeLayout } from './merge'
export { probeImageSize } from './image-size'
export type { ImageSize } from './image-size'

/** 组装为 core 扩展片段 */
export function mergeExtension() {
  return { mergeImages }
}

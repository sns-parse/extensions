/**
 * @sns-parse/ext-gif：视频转 GIF（ffmpeg palettegen/paletteuse）。
 */
import { mp4ToGif } from './gif'

export { mp4ToGif, resolveFfmpeg, gifFilter, gifDuration } from './gif'
export type { GifOptions } from './gif'

/** 组装为 core 扩展片段 */
export function gifExtension() {
  return { mp4ToGif }
}

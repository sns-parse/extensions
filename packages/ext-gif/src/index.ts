/**
 * @sns-parse/ext-gif：视频转 GIF（ffmpeg palettegen/paletteuse）。
 * 经 WorkflowExtension.setup(hooks) 注入 transcode 阶段（替换基线不转换）。
 */
import { mp4ToGif } from './gif'
import type { WorkflowExtension } from '@sns-parse/core'

export { mp4ToGif, resolveFfmpeg, gifFilter, gifDuration } from './gif'
export type { GifOptions } from './gif'

/** 组装为 core 扩展片段（钩子注入） */
export function gifExtension(): WorkflowExtension {
  return {
    name: 'ext-gif',
    setup(hooks) {
      hooks.replace('transcode', (input, rt) => mp4ToGif(rt, input.url, input.durationSec, input.opts))
    },
  }
}

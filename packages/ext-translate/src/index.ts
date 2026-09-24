/**
 * @sns-parse/ext-translate：推文翻译（Google gtx + MyMemory 兜底）。
 * 经 WorkflowExtension.setup(hooks) 注入 translate 阶段（替换基线不翻译）。
 */
import { translateText } from './translate'
import type { WorkflowExtension } from '@sns-parse/core'

export { translateText, shouldSkipTranslate, langName } from './translate'
export type { TranslateResult } from './translate'

/** 组装为 core 扩展片段（钩子注入） */
export function translateExtension(): WorkflowExtension {
  return {
    name: 'ext-translate',
    setup(hooks) {
      hooks.replace('translate', (input, rt) => translateText(rt, input.text, input.target, input.sourceLang))
    },
  }
}

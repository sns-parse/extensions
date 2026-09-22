/**
 * @sns-parse/ext-translate：推文翻译（Google gtx + MyMemory 兜底）。
 */
import { translateText } from './translate'

export { translateText, shouldSkipTranslate, langName } from './translate'
export type { TranslateResult } from './translate'

/** 组装为 core 扩展片段 */
export function translateExtension() {
  return { translate: translateText }
}

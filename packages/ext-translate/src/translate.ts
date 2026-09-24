/**
 * 通用翻译（Google gtx + MyMemory 兜底，无 Key，GET-only）。
 * 语种决策/展示工具（shouldSkipTranslate/langName）在 @sns-parse/core；
 * 平台原生翻译（如 X 网页同源 Grok）在对应平台包的 translate 钩子。
 */
import type { ParserRuntimeLike, TranslateResult } from '@sns-parse/core'
import { debugLog, logger } from '@sns-parse/core'

export type { TranslateResult }
export { shouldSkipTranslate, langName } from '@sns-parse/core'
/** 翻译文本；失败返回 null（调用方保持无译文继续发送）。gtx 优先，MyMemory 兜底 */
export async function translateText(rt: ParserRuntimeLike, text: string, target: string, sourceLang?: string): Promise<TranslateResult | null> {
  if (!text) return null
  const out = await viaGtx(rt, text, target)
  if (out) return { text: out, provider: 'Google' }
  const backup = await viaMyMemory(rt, text, target, sourceLang)
  if (backup) return { text: backup, provider: 'MyMemory' }
  return null
}

/** Google gtx 免费端点（无 Key；sl=auto 自动检测源语种） */
async function viaGtx(rt: ParserRuntimeLike, text: string, target: string): Promise<string | null> {
  const url = 'https://translate.googleapis.com/translate_a/single' +
    `?client=gtx&sl=auto&dt=t&tl=${encodeURIComponent(target)}` +
    `&q=${encodeURIComponent(text.slice(0, 2000))}`
  try {
    const res = await rt.http.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': rt.config.userAgent },
    })
    const data: any = res.data
    // gtx 响应形如 [[["译文","原文",null,null,10]],null,"fr",...]
    if (Array.isArray(data?.[0])) {
      const out = data[0].map((seg: any) => (typeof seg?.[0] === 'string' ? seg[0] : '')).join('').trim()
      if (out) return out
    }
    debugLog('gtx 翻译响应结构异常，尝试备用通道')
    return null
  } catch (e: any) {
    debugLog(`gtx 翻译失败：${e?.message || e}`)
    return null
  }
}

/** MyMemory 备用（免费无 Key；需已知源语种，不支持 auto） */
async function viaMyMemory(rt: ParserRuntimeLike, text: string, target: string, sourceLang?: string): Promise<string | null> {
  const sl = normalizeLang(sourceLang)
  if (!sl) return null
  const tl = target.toLowerCase()
  const url = 'https://api.mymemory.translated.net/get' +
    `?q=${encodeURIComponent(text.slice(0, 500))}&langpair=${encodeURIComponent(sl + '|' + tl)}`
  try {
    const res = await rt.http.get(url, { timeout: 15000, headers: { 'User-Agent': rt.config.userAgent } })
    const out = res.data?.responseData?.translatedText
    if (typeof out === 'string' && out.trim() && !/^MYMEMORY WARNING/i.test(out)) return out.trim()
    debugLog('MyMemory 翻译响应异常，放弃译文')
    return null
  } catch (e: any) {
    logger.info(`推文翻译失败（跳过译文继续发送）：${e?.message || e}`)
    return null
  }
}

function normalizeLang(lang?: string): string | null {
  if (!lang) return null
  const l = lang.toLowerCase()
  if (l === 'und' || l === 'zxx') return null
  if (l.startsWith('zh')) return 'zh-CN'
  return l.split('-')[0]
}

/**
 * 通用自定义 REST 审核模板。
 *
 * 配置：endpoint + method + headers(JSON) + bodyTemplate（占位 ${url} ${base64}）
 *       + verdictJsonPath（点路径，支持 [n]）+ nsfwValues（命中值集合）。
 * 判定：路径取值 ∈ nsfwValues → 命中；值缺失视为异常（外层 fail-closed）。
 */
import type { AxiosInstance } from 'axios'
import type { CheckInput, CheckResult, ModerationProvider, CustomConf } from './types'

/** 简化 JSONPath：a.b[0].c */
export function getPath(obj: any, path: string): any {
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), obj)
}

export function createCustomProvider(conf: CustomConf, http: AxiosInstance): ModerationProvider {
  return {
    name: 'custom',
    async check(input: CheckInput): Promise<CheckResult> {
      const body = (conf.bodyTemplate || '')
        .replace(/\$\{url\}/g, input.url)
        .replace(/\$\{base64\}/g, input.buffer.toString('base64'))
      let headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (conf.headersJson) {
        try { headers = { ...headers, ...JSON.parse(conf.headersJson) } } catch { /* 保持默认头 */ }
      }
      const method = (conf.method || 'POST').toUpperCase()
      const res = method === 'GET'
        ? await http.get(conf.endpoint, { params: Object.fromEntries(new URLSearchParams(body)), headers, timeout: 15000 })
        : await http.post(conf.endpoint, body, { headers, timeout: 15000 })
      const verdict = getPath(res.data, conf.verdictJsonPath)
      if (verdict === undefined || verdict === null) throw new Error('自定义审核模板未取到判定字段')
      const values = conf.nsfwValues || ['true', 'block', 'nsfw', '1']
      const hit = values.map(String).includes(String(verdict))
      return { nsfw: hit, label: hit ? String(verdict) : '' }
    },
  }
}

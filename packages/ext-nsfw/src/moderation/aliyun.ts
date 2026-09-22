/**
 * 阿里云内容安全 Green（ImageSyncScan，RPC 签名 HMAC-SHA1）。
 *
 * 送审：原始 URL（scenes: porn/terrorism）。
 * 判定：深搜响应中 results[].suggestion === 'block' 命中；'review' 按疑似命中（保守）。
 */
import { createHmac } from 'crypto'
import type { AxiosInstance } from 'axios'
import type { CheckInput, CheckResult, ModerationProvider, AliyunConf } from './types'

const HOST = 'green.cn-shanghai.aliyuncs.com'

/** RFC3986 percentEncode（阿里云 RPC 签名专用） */
export function percentEncode(s: string): string {
  return encodeURIComponent(s)
    .replace(/\+/g, '%20')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~')
}

/** 导出签名构造供测试断言 */
export function aliyunSignature(params: Record<string, string>, secretKey: string): string {
  const sorted = Object.keys(params).sort().map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`).join('&')
  const stringToSign = `GET&${percentEncode('/')}&${percentEncode(sorted)}`
  return createHmac('sha1', `${secretKey}&`).update(stringToSign, 'utf8').digest('base64')
}

/** 深搜响应中所有 {suggestion, label, rate} */
function findSuggestions(obj: any, acc: any[] = []): any[] {
  if (!obj || typeof obj !== 'object') return acc
  if (typeof obj.suggestion === 'string') acc.push(obj)
  for (const v of Object.values(obj)) {
    if (Array.isArray(v)) v.forEach((x) => findSuggestions(x, acc))
    else if (v && typeof v === 'object') findSuggestions(v, acc)
  }
  return acc
}

export function createAliyunProvider(conf: AliyunConf, http: AxiosInstance): ModerationProvider {
  return {
    name: 'aliyun',
    async check(input: CheckInput): Promise<CheckResult> {
      const params: Record<string, string> = {
        AccessKeyId: conf.accessKeyId,
        Action: 'ImageSyncScan',
        Format: 'JSON',
        RegionId: conf.region || 'cn-shanghai',
        Scenes: JSON.stringify(['porn', 'terrorism']),
        SignatureMethod: 'HMAC-SHA1',
        SignatureNonce: Math.random().toString(36).slice(2),
        SignatureVersion: '1.0',
        Tasks: JSON.stringify([{ dataId: input.url.slice(0, 128), url: input.url }]),
        Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        Version: '2018-05-09',
      }
      params.Signature = aliyunSignature(params, conf.accessKeySecret)
      const res = await http.get(`https://${HOST}/`, { params, timeout: 15000 })
      const data = res.data || {}
      if (data.code || data.Code) {
        throw new Error(`阿里云审核错误 ${data.code || data.Code}: ${data.msg || data.Message}`)
      }
      const suggestions = findSuggestions(data)
      if (!suggestions.length) throw new Error('阿里云审核返回无判定结果')
      const hit = suggestions.find((s) => s.suggestion === 'block' || s.suggestion === 'review')
      return {
        nsfw: !!hit,
        label: hit ? String(hit.label || '违规') : '',
        score: hit ? Number(hit.rate ?? 0) / 100 : undefined,
      }
    },
  }
}

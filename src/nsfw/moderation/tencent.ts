/**
 * 腾讯云图片审核 IMS（ImageModeration, 2020-12-29，TC3-HMAC-SHA256 签名）。
 *
 * 送审：原始 URL（FileUrl）。
 * 判定：Suggestion 'Block' 或 'Review' 按命中（保守）。
 */
import { createHash, createHmac } from 'crypto'
import type { AxiosInstance } from 'axios'
import type { CheckInput, CheckResult, ModerationProvider, TencentConf } from './types'

const ACTION = 'ImageModeration'
const VERSION = '2020-12-29'
const SERVICE = 'ims'

function sha256hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}

function hmac(key: Buffer | string, msg: string): Buffer {
  return createHmac('sha256', key).update(msg, 'utf8').digest()
}

/** 导出 TC3 签名构造供测试断言（固定时间戳） */
export function tencentTc3Sign(secretId: string, secretKey: string, payload: string, timestamp: number, region: string): Record<string, string> {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const host = `${SERVICE}.tencentcloudapi.com`
  const hashedPayload = sha256hex(payload)
  const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-tc-action:${ACTION.toLowerCase()}\n`
  const signedHeaders = 'content-type;host;x-tc-action'
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${hashedPayload}`
  const credentialScope = `${date}/${SERVICE}/tc3_request`
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${sha256hex(canonicalRequest)}`
  const secretDate = hmac(`TC3${secretKey}`, date)
  const secretService = hmac(secretDate, SERVICE)
  const secretSigning = hmac(secretService, 'tc3_request')
  const signature = createHmac('sha256', secretSigning).update(stringToSign, 'utf8').digest('hex')
  return {
    Authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'X-TC-Action': ACTION,
    'X-TC-Timestamp': String(timestamp),
    'X-TC-Version': VERSION,
    'X-TC-Region': region,
    Host: host,
  }
}

export function createTencentProvider(conf: TencentConf, http: AxiosInstance): ModerationProvider {
  return {
    name: 'tencent',
    async check(input: CheckInput): Promise<CheckResult> {
      const payload = JSON.stringify({ FileUrl: input.url })
      const headers = tencentTc3Sign(conf.secretId, conf.secretKey, payload, Math.floor(Date.now() / 1000), conf.region || 'ap-guangzhou')
      const res = await http.post(`https://${headers.Host}/`, payload, {
        headers: { ...headers, 'Content-Type': 'application/json' },
        timeout: 15000,
      })
      const resp = res.data?.Response
      if (!resp || res.data?.Error) {
        throw new Error(`腾讯云审核错误: ${res.data?.Error?.Code || '无响应'}`)
      }
      const suggestion = String(resp.Suggestion || 'Review')
      return {
        nsfw: suggestion !== 'Pass',
        label: String(resp.Label || ''),
        score: Number(resp.Score ?? 0) / 100,
      }
    },
  }
}

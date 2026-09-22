/**
 * 网易易盾 图片在线检测（v5.2）。
 *
 * 签名：md5(secretId + secretKey + timestamp + nonce)。
 * 判定：labels 中存在 level <= 2（1=确认违规 2=嫌疑）按命中（保守）；空 labels 合规。
 */
import { createHash } from 'crypto'
import type { AxiosInstance } from 'axios'
import type { CheckInput, CheckResult, ModerationProvider, YidunConf } from './types'

const CHECK_URL = 'https://as.dun.163.com/v5/image/check'

function md5(s: string): string {
  return createHash('md5').update(s, 'utf8').digest('hex')
}

/** 导出签名串构造供测试断言 */
export function yidunSignature(secretId: string, secretKey: string, timestamp: number, nonce: string): string {
  return md5(`${secretId}${secretKey}${timestamp}${nonce}`)
}

export function createYidunProvider(conf: YidunConf, http: AxiosInstance): ModerationProvider {
  return {
    name: 'yidun',
    async check(input: CheckInput): Promise<CheckResult> {
      const timestamp = Date.now()
      const nonce = Math.random().toString(36).slice(2, 12)
      const images = [{ type: 2, data: input.buffer.toString('base64') }]
      const res = await http.post(CHECK_URL, new URLSearchParams({
        secretId: conf.secretId,
        version: 'v5.2',
        timestamp: String(timestamp),
        nonce,
        signature: yidunSignature(conf.secretId, conf.secretKey, timestamp, nonce),
        images: JSON.stringify(images),
      }).toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000,
      })
      const data = res.data || {}
      if (data.code !== 200) throw new Error(`易盾审核错误 ${data.code}: ${data.msg}`)
      const img = data.result?.images?.[0] || {}
      const labels: any[] = Array.isArray(img.labels) ? img.labels : []
      if (!labels.length) return { nsfw: false, label: '' }
      const hit = labels.find((l) => Number(l.level ?? 3) <= 2)
      return {
        nsfw: !!hit,
        label: hit ? String(hit.subLabel || hit.label || '违规') : '',
        score: hit ? Number(hit.rate ?? 0) / 100 : undefined,
      }
    },
  }
}

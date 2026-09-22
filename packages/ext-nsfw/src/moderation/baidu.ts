/**
 * 百度智能云内容审核（图像审核 v2）。
 *
 * 认证：API Key + Secret Key 换取 access_token（有效期 30 天，缓存 29 天）。
 * 判定：conclusionType 1=合规 2=不合规 3=疑似 4=失败；>=2 按命中（保守）。
 */
import type { AxiosInstance } from 'axios'
import type { CheckInput, CheckResult, ModerationProvider, BaiduConf } from './types'

const TOKEN_URL = 'https://aip.baidubce.com/oauth/2.0/token'
const CHECK_URL = 'https://aip.baidubce.com/rest/2.0/solutions/v3/img_censor/v2/user_defined'

/** access_token 模块级缓存（key = apiKey） */
const tokenStore = new Map<string, { token: string; expiresAt: number }>()

async function getAccessToken(http: AxiosInstance, conf: BaiduConf): Promise<string> {
  const cached = tokenStore.get(conf.apiKey)
  if (cached && cached.expiresAt > Date.now()) return cached.token
  const res = await http.post(TOKEN_URL, null, {
    params: {
      grant_type: 'client_credentials',
      client_id: conf.apiKey,
      client_secret: conf.secretKey,
    },
    timeout: 15000,
  })
  const token = res.data?.access_token
  if (!token) throw new Error('百度审核 access_token 获取失败')
  tokenStore.set(conf.apiKey, { token, expiresAt: Date.now() + 29 * 24 * 3600 * 1000 })
  return token
}

export function createBaiduProvider(conf: BaiduConf, http: AxiosInstance): ModerationProvider {
  return {
    name: 'baidu',
    async check(input: CheckInput): Promise<CheckResult> {
      const token = await getAccessToken(http, conf)
      const res = await http.post(CHECK_URL, `image=${encodeURIComponent(input.buffer.toString('base64'))}`, {
        params: { access_token: token },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000,
      })
      const data = res.data || {}
      if (data.error_code) throw new Error(`百度审核错误 ${data.error_code}: ${data.error_msg}`)
      const conclusion = Number(data.conclusionType ?? 4)
      const label = String(data.conclusion || '')
      // 1 合规；2 不合规；3 疑似；4/其他 视为失败（由外层 fail-closed 兜底）
      if (conclusion === 4 || (!data.conclusionType && !data.conclusion)) {
        throw new Error('百度审核返回异常结果')
      }
      return { nsfw: conclusion >= 2, label }
    },
  }
}

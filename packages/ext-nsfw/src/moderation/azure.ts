/**
 * Azure AI Content Safety（图像分析）。
 *
 * 认证：Ocp-Apim-Subscription-Key（资源密钥），endpoint 为资源地址
 * （如 https://<resource>.cognitiveservices.azure.com）。
 * 可配置：送审类别（Sexual/Violence/Hate/SelfHarm）、命中阈值（0-6）、
 * 自定义阻止列表（需先在 Azure 门户/管理 API 创建）。
 */
import type { AxiosInstance } from 'axios'
import type { CheckInput, CheckResult, ModerationProvider, AzureConf } from './types'

export const AZURE_SEVERITY_THRESHOLD = 2

export function createAzureProvider(conf: AzureConf, http: AxiosInstance): ModerationProvider {
  const categories = conf.categories?.length ? conf.categories : ['Sexual', 'Violence']
  const threshold = conf.severityThreshold ?? AZURE_SEVERITY_THRESHOLD
  return {
    name: 'azure',
    async check(input: CheckInput): Promise<CheckResult> {
      const base = (conf.endpoint || '').replace(/\/+$/, '')
      const body: any = {
        image: { content: input.buffer.toString('base64') },
        categories,
      }
      if (conf.blocklistNames?.length) body.blocklistNames = conf.blocklistNames
      const res = await http.post(`${base}/contentsafety/image:analyze?api-version=2023-10-01`, body, {
        headers: { 'Ocp-Apim-Subscription-Key': conf.apiKey, 'Content-Type': 'application/json' },
        timeout: 15000,
      })
      const analysis = res.data?.categoriesAnalysis
      if (!Array.isArray(analysis) || !analysis.length) throw new Error('Azure 审核返回无判定结果')
      const hit = analysis.find((c: any) => Number(c.severity ?? 0) >= threshold)
      const detail = analysis.map((c: any) => `${c.category || '?'}=${Number(c.severity ?? 0)}`).join(', ')
      return {
        nsfw: !!hit,
        label: hit ? String(hit.category || '') : '',
        score: hit ? Number(hit.severity) / 6 : undefined,
        detail,
      }
    },
  }
}

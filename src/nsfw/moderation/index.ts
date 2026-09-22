/**
 * Provider 工厂 + fail-closed 包装。
 *
 * fail-closed：任何异常（网络/凭证/响应异常）一律返回 {nsfw:true}——
 * 审核服务故障时按命中处理（宁可错杀，不放行）。结果经缓存去重。
 */
import type { AxiosInstance } from 'axios'
import { logger } from '@sns-parse/core'
import { getCached, setCached } from './cache'
import { createBaiduProvider } from './baidu'
import { createYidunProvider } from './yidun'
import { createAliyunProvider } from './aliyun'
import { createTencentProvider } from './tencent'
import { createAzureProvider } from './azure'
import { createCustomProvider } from './custom'
import type { CheckInput, CheckResult, ModerationProvider, ProviderConf } from './types'

export * from './types'
export { yidunSignature } from './yidun'
export { aliyunSignature, percentEncode } from './aliyun'
export { tencentTc3Sign } from './tencent'
export { getPath } from './custom'

/** 从插件 config 构建 Provider；配置缺失返回 null（未启用审核） */
export function createProvider(conf: ProviderConf, http: AxiosInstance): ModerationProvider | null {
  switch (conf.provider) {
    case 'baidu':
      return conf.baidu?.apiKey ? createBaiduProvider(conf.baidu, http) : null
    case 'yidun':
      return conf.yidun?.secretId ? createYidunProvider(conf.yidun, http) : null
    case 'aliyun':
      return conf.aliyun?.accessKeyId ? createAliyunProvider(conf.aliyun, http) : null
    case 'tencent':
      return conf.tencent?.secretId ? createTencentProvider(conf.tencent, http) : null
    case 'azure':
      return conf.azure?.apiKey && conf.azure?.endpoint ? createAzureProvider(conf.azure, http) : null
    case 'custom':
      return conf.custom?.endpoint ? createCustomProvider(conf.custom, http) : null
    default:
      return null
  }
}

/** fail-closed 包装：异常 → 命中；带结果缓存 */
export function withFailClosed(provider: ModerationProvider): ModerationProvider {
  return {
    name: provider.name,
    async check(input: CheckInput): Promise<CheckResult> {
      const cached = getCached(input)
      if (cached) return cached
      let result: CheckResult
      try {
        result = await provider.check(input)
      } catch (e: any) {
        logger.warn(`内容安全审核异常（fail-closed 按命中处理）: ${e?.message || e}`)
        result = { nsfw: true, label: '审核服务异常' }
      }
      setCached(input, result)
      return result
    },
  }
}

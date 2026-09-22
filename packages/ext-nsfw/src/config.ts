/**
 * ext-nsfw 的配置声明（中立 DSL）。
 * koishi / cli 兼容层据此动态生成各自配置。
 */
import { defineConfig, type ConfigContribution } from '@sns-parse/core'

const ALL_PLATFORMS = [
  'bilibili', 'douyin', 'kuaishou', 'xiaohongshu', 'weibo', 'xigua', 'youtube',
  'tiktok', 'acfun', 'zhihu', 'weishi', 'huya', 'haokan', 'meipai', 'twitter',
  'instagram', 'doubao', 'doubao_image', 'jimeng', 'oasis', 'wechat_channel',
  'lishi', 'quanmin', 'pipigx', 'pipixia', 'zuiyou', 'toutiao',
] as const

const modeValues = [
  { value: 'off', description: '关闭' },
  { value: 'full', description: '全量处理（配置审核后自动等效 smart）' },
  { value: 'smart', description: '内容审核判定' },
]
const inheritableModeValues = [
  { value: 'inherit', description: '跟随全局（默认）' },
  ...modeValues,
]
const imageActionValues = [
  { value: 'scramble', description: '混淆图片 + 还原 token' },
  { value: 'link', description: '仅发送图片链接文字' },
  { value: 'drop', description: '不发送' },
]
const videoActionValues = [
  { value: 'redeem', description: '暂存视频 + 请求者私聊凭 token 取回' },
  { value: 'link', description: '仅发送视频原链接文字' },
  { value: 'drop', description: '不发送' },
]

export const nsfwConfigContribution: ConfigContribution = defineConfig({
  group: '内容安全与图片混淆',
  fields: [
    {
      key: 'nsfwPolicy', type: 'object', description: '处理策略',
      fields: [
        { key: 'imageAction', type: 'union', default: 'scramble', description: '图片命中后的动作', values: imageActionValues },
        { key: 'videoAction', type: 'union', default: 'redeem', description: '视频命中后的动作（封面送审判定）', values: videoActionValues },
        { key: 'scrambleAvatar', type: 'boolean', default: false, description: '作者头像也参与混淆（默认跳过）' },
        {
          key: 'tokenHintText', type: 'string', role: 'textarea',
          default: '检测到可能不适宜的内容，已混淆 ${count} 张图片。如需查看：将图片转发到与机器人的私聊，随消息发送「解混淆 + 取件码」即可还原（取件码见各混淆图消息，群里直接发取件码无效）。',
          description: '图片混淆提示文案（占位 ${count}）',
        },
        {
          key: 'videoCardHint', type: 'string', role: 'textarea',
          default: '检测到受限视频，未在群内发送。原视频暂存至 ${until}，私聊发送「取视频 + 取件码」领取（取件码见下条消息）。',
          description: '受限视频提示文案（占位 ${until} ${ttl}）',
        },
      ],
    },
    { key: 'nsfwGlobalMode', type: 'union', default: 'off', description: '全平台默认处理模式（平台级可覆盖）', values: modeValues },
    {
      key: 'nsfwPlatformMode', type: 'object',
      description: '平台处理模式（inherit=跟随全局；显式设置可覆盖全局一刀切）',
      fields: ALL_PLATFORMS.map(p => ({ key: p, type: 'union' as const, default: 'inherit', description: p, values: inheritableModeValues })),
    },
    { key: 'nsfwAdvancedPolicy', type: 'boolean', default: false, description: '启用平台级高级策略覆盖' },
    {
      key: 'nsfwPlatformPolicyAdvanced', type: 'array', default: [], description: '平台高级策略（覆盖全局）',
      itemFields: [
        { key: 'platform', type: 'union', description: '平台', values: ALL_PLATFORMS.map(p => ({ value: p })) },
        { key: 'mode', type: 'union', default: 'smart', description: '处理模式', values: modeValues },
        { key: 'imageAction', type: 'union', description: '图片动作（默认继承全局）', values: imageActionValues },
        { key: 'videoAction', type: 'union', description: '视频动作（默认继承全局）', values: videoActionValues },
      ],
    },
    {
      key: 'nsfwModeration', type: 'object', description: '内容安全审核',
      fields: [
        {
          key: 'provider', type: 'union', default: 'baidu', description: '审核服务商（配置有效凭证后生效）',
          values: [
            { value: 'baidu', description: '百度智能云' },
            { value: 'yidun', description: '网易易盾' },
            { value: 'aliyun', description: '阿里云' },
            { value: 'tencent', description: '腾讯云' },
            { value: 'azure', description: 'Azure Content Safety' },
            { value: 'custom', description: '自定义 REST 模板' },
          ],
        },
        {
          key: 'baidu', type: 'object', description: '百度智能云凭证',
          fields: [
            { key: 'apiKey', type: 'string', role: 'secret', default: '', description: 'API Key' },
            { key: 'secretKey', type: 'string', role: 'secret', default: '', description: 'Secret Key' },
          ],
        },
        {
          key: 'yidun', type: 'object', description: '网易易盾凭证',
          fields: [
            { key: 'secretId', type: 'string', role: 'secret', default: '', description: 'secretId' },
            { key: 'secretKey', type: 'string', role: 'secret', default: '', description: 'secretKey' },
          ],
        },
        {
          key: 'aliyun', type: 'object', description: '阿里云凭证',
          fields: [
            { key: 'accessKeyId', type: 'string', role: 'secret', default: '', description: 'AccessKeyId' },
            { key: 'accessKeySecret', type: 'string', role: 'secret', default: '', description: 'AccessKeySecret' },
          ],
        },
        {
          key: 'tencent', type: 'object', description: '腾讯云凭证',
          fields: [
            { key: 'secretId', type: 'string', role: 'secret', default: '', description: 'SecretId' },
            { key: 'secretKey', type: 'string', role: 'secret', default: '', description: 'SecretKey' },
          ],
        },
        {
          key: 'azure', type: 'object', description: 'Azure Content Safety',
          fields: [
            { key: 'endpoint', type: 'string', default: '', description: '资源地址 https://<resource>.cognitiveservices.azure.com' },
            { key: 'apiKey', type: 'string', role: 'secret', default: '', description: 'Ocp-Apim-Subscription-Key' },
            {
              key: 'categories', type: 'array', default: ['Sexual', 'Violence'], description: '送审类别',
              itemType: 'union',
              values: [
                { value: 'Sexual', description: '性内容' },
                { value: 'Violence', description: '暴力' },
                { value: 'Hate', description: '仇恨' },
                { value: 'SelfHarm', description: '自残' },
              ],
            },
            { key: 'severityThreshold', type: 'number', min: 0, max: 6, step: 1, default: 2, description: '命中阈值（severity ≥ 此值判命中，0 最严 6 最松）' },
            { key: 'blocklistNames', type: 'array', default: [], itemType: 'string', description: '阻止列表名称（需在 Azure 门户预先创建）' },
          ],
        },
        {
          key: 'custom', type: 'object', description: '自定义 REST 模板',
          fields: [
            { key: 'endpoint', type: 'string', default: '', description: '审核接口地址' },
            { key: 'method', type: 'union', default: 'POST', description: '请求方法', values: [{ value: 'GET' }, { value: 'POST' }] },
            { key: 'headersJson', type: 'string', role: 'textarea', default: '{}', description: '请求头 JSON（可选）' },
            { key: 'bodyTemplate', type: 'string', role: 'textarea', default: '{"image":"${base64}"}', description: '请求体模板（占位 ${url} ${base64}）' },
            { key: 'verdictJsonPath', type: 'string', default: 'data.nsfw', description: '判定字段路径，如 data.results[0].nsfw' },
            { key: 'nsfwValues', type: 'array', default: ['true', 'block', 'nsfw', '1'], itemType: 'string', description: '判定字段命中值集合' },
          ],
        },
      ],
    },
    {
      key: 'nsfwVault', type: 'object', description: '受限视频暂存',
      fields: [
        { key: 'ttlMinutes', type: 'number', min: 1, default: 30, description: '暂存时长（分钟）' },
        { key: 'maxItems', type: 'number', min: 1, default: 20, description: '暂存条数上限' },
        { key: 'maxItemMB', type: 'number', min: 1, default: 200, description: '单条体积上限（MB，超限改发链接）' },
        { key: 'budgetMB', type: 'number', min: 1, default: 600, description: '暂存总预算（MB，LRU 驱逐）' },
        { key: 'tokenShare', type: 'boolean', default: true, description: '取件码共享：任何持有者可领取（关闭则仅限原请求者）' },
      ],
    },
  ],
})

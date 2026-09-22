# @sns-parse/extensions

sns-parse 的扩展集合：为 `@sns-parse/core` 的 `VideoParserExtensions` 契约提供默认实现。

## 能力

| 能力 | 说明 |
|------|------|
| NSFW 审核 | 百度/易盾/阿里云/腾讯云/Azure/自定义 REST，fail-closed，结果缓存 |
| 图片混淆 | 依赖可选服务 `ferret-transform`（宿主注入），失败降级为链接 |
| 受限视频暂存 | 内存 LRU + 请求者绑定 + TTL，私聊凭 token 领取 |
| 同源切图合并 | 纯像素内容裁决（ffmpeg），网格/竖堆/横拼 |
| 翻译 | Google gtx + MyMemory 兜底 |
| GIF 转换 | ffmpeg（palettegen/paletteuse） |

## 用法

```ts
import { createDefaultExtensions } from '@sns-parse/extensions'
const extensions = createDefaultExtensions()
```

## 许可

MIT

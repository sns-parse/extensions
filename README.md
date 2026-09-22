# sns-parse extensions

sns-parse 的扩展 monorepo——**每个扩展一个包**：

| 包 | 说明 |
|----|------|
| `@sns-parse/ext-nsfw` | 内容安全：审核（百度/易盾/阿里云/腾讯云/Azure/自定义）、图片混淆、受限视频暂存 |
| `@sns-parse/ext-merge` | 同源切图纯内容识别合并（ffmpeg） |
| `@sns-parse/ext-translate` | 推文翻译（Google gtx + MyMemory 兜底） |
| `@sns-parse/ext-gif` | 视频转 GIF（ffmpeg） |

每个包导出对应实现，并提供一个 `*Extension()` 片段，供宿主组装 `@sns-parse/core` 的 `VideoParserExtensions`：

```ts
import { nsfwExtension } from '@sns-parse/ext-nsfw'
import { mergeExtension } from '@sns-parse/ext-merge'
import { translateExtension } from '@sns-parse/ext-translate'
import { gifExtension } from '@sns-parse/ext-gif'

const extensions = { ...nsfwExtension(), ...mergeExtension(), ...translateExtension(), ...gifExtension() }
```

## 开发 / 发布

```bash
npm install
npm run build
npm publish --workspaces --access public --tag alpha
```

## 许可

MIT

/**
 * 同源切图识别与合并（纯内容识别，不依赖 URL/文件名等外部信息）：
 * - 候选布局：n∈{4,9,16} 且各片等尺寸 → n×n 宫格；各片同宽 → 垂直堆叠；各片同高 → 水平拼接
 * - 内容验证：ffmpeg 解码为 256 宽灰度图，比较接缝两侧边界行/列的平均绝对差（MAD），
 *   与图片内部相邻行/列的自然差异比较——母图切片在接缝处连续（比值≈1），无关图片差异显著（比值≫1）
 * - 合并：宫格 xstack / 垂直 vstack / 水平 hstack
 *
 * 识别/解码/ffmpeg 任一环节失败均返回 null，调用方回退逐张发送。
 */
import { spawn } from 'child_process'
import { randomBytes } from 'crypto'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ParserRuntimeLike } from '@sns-parse/core'
import { probeImageSize, type ImageSize } from '@sns-parse/core'
import { resolveFfmpeg } from '@sns-parse/ext-gif'
import { debugLog, logger } from '@sns-parse/core'

export type MergeLayout =
  | { kind: 'grid'; cols: number; rows: number }
  | { kind: 'v' }
  | { kind: 'h' }

const MAX_PIECES = 12
/** 同一母图切出的分片尺寸精确相等，仅留极小容差防探测/编解码舍入 */
const DIM_TOLERANCE = 2
const MAX_OUTPUT_SIDE = 4096
const MAX_TOTAL_BYTES = 150 * 1048576
/** 灰度归一化宽度（边界行/列向量长度基准） */
const GRAY_W = 256
/** 列向量统一重采样长度 */
const COL_LEN = 64
/** 接缝差异 / 内部自然差异 的判定阈值（母图切片 ≈1，无关图片 ≫1；下限 3 防平坦图除零） */
const BOUNDARY_THRESH = 3.0
const MAD_FLOOR = 3.0
/** 单缝边界容差：平台（如 X）对各分片独立重压缩会让个别接缝低频轻微错位。
 *  仅当接缝总数 ≥3（≥4 图，多条缝相互印证）且恰好一条落在
 *  [BOUNDARY_THRESH, BORDERLINE_THRESH)、其余全部通过时放行；平坦不可验证缝不参与容差 */
const BORDERLINE_THRESH = 5.0
const BORDERLINE_MAX = 1
const BORDERLINE_MIN_SEAMS = 3
/** 边界带纹理能量下限：低于此值视为「不可验证接缝」（相似背景/平边照片会骗过亮度对比） */
const TEXTURE_MIN = 4.0

/* ---------- 尺寸候选 ---------- */

function dimsEqual(a: ImageSize, b: ImageSize, tol: number): boolean {
  return Math.abs(a.width - b.width) <= tol && Math.abs(a.height - b.height) <= tol
}

/** 仅凭数量与尺寸给出全部可行布局（内容验证前） */
export function candidateLayouts(n: number, sizes: ImageSize[]): MergeLayout[] {
  if (n < 2 || n > MAX_PIECES) return []
  if (sizes.some((s) => !s || s.width < 8 || s.height < 8)) return []
  const out: MergeLayout[] = []
  const sqrt = Math.sqrt(n)
  if (Number.isInteger(sqrt) && sizes.every((s) => dimsEqual(s, sizes[0], DIM_TOLERANCE))) {
    out.push({ kind: 'grid', cols: sqrt, rows: sqrt })
  }
  if (sizes.every((s) => Math.abs(s.width - sizes[0].width) <= DIM_TOLERANCE)) out.push({ kind: 'v' })
  if (sizes.every((s) => Math.abs(s.height - sizes[0].height) <= DIM_TOLERANCE)) out.push({ kind: 'h' })
  return out
}

/* ---------- 灰度边界向量 ---------- */

/** 解码为固定宽度灰度原始流（buf = rows × GRAY_W 字节） */
function toGray(file: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveFfmpeg(), [
      '-hide_banner', '-loglevel', 'error', '-i', file,
      '-vf', `scale=${GRAY_W}:-2:flags=area,format=gray`, '-f', 'rawvideo', 'pipe:1',
    ])
    const chunks: Buffer[] = []
    child.stdout.on('data', (d: Buffer) => chunks.push(d))
    child.stderr.on('data', (d: Buffer) => reject(new Error(d.toString().slice(0, 120))))
    child.on('error', (e) => reject(e))
    child.on('close', (code) => {
      const buf = Buffer.concat(chunks)
      if (code === 0 && buf.length >= GRAY_W * 2) resolve(buf)
      else reject(new Error(`gray decode exit ${code}`))
    })
  })
}

function grayRows(g: Buffer): number {
  return Math.floor(g.length / GRAY_W)
}

/** 取一行（256 长） */
function rowOf(g: Buffer, r: number): Float32Array {
  const rows = grayRows(g)
  const rr = Math.min(Math.max(r, 0), rows - 1)
  const out = new Float32Array(GRAY_W)
  for (let x = 0; x < GRAY_W; x++) out[x] = g[rr * GRAY_W + x]
  return out
}

/** 取一列（重采样到 COL_LEN，适配各片灰度高度不一） */
function colOf(g: Buffer, c: number): Float32Array {
  const rows = grayRows(g)
  const cc = Math.min(Math.max(c, 0), GRAY_W - 1)
  const out = new Float32Array(COL_LEN)
  for (let i = 0; i < COL_LEN; i++) {
    const y = Math.min(rows - 1, Math.round((i / (COL_LEN - 1)) * (rows - 1)))
    out[i] = g[y * GRAY_W + cc]
  }
  return out
}

function mad(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i])
  return sum / a.length
}

/** 滑动平均（提取平滑趋势） */
function smooth(v: Float32Array): Float32Array {
  const win = Math.max(3, Math.floor(v.length / 16) | 1)
  const out = new Float32Array(v.length)
  let sum = 0
  for (let i = 0; i < v.length; i++) {
    sum += v[i]
    if (i >= win) sum -= v[i - win]
    out[i] = sum / Math.min(i + 1, win)
  }
  return out
}

/** 去趋势残差（高频纹理成分） */
function residual(v: Float32Array): Float32Array {
  const s = smooth(v)
  const out = new Float32Array(v.length)
  for (let i = 0; i < v.length; i++) out[i] = v[i] - s[i]
  return out
}

function std(v: Float32Array): number {
  let mean = 0
  for (let i = 0; i < v.length; i++) mean += v[i]
  mean /= v.length
  let acc = 0
  for (let i = 0; i < v.length; i++) acc += (v[i] - mean) ** 2
  return Math.sqrt(acc / v.length)
}

export interface SeamVerdict {
  /** false = 接缝不可验证（边界带平坦，无纹理可判）或不连续 */
  ok: boolean
  score: number
  /** 证据明细（供 debug 日志） */
  dir: 'V' | 'H'
  from: number
  to: number
  /** 边界带高频纹理能量（两侧最大值；低于 TEXTURE_MIN 即不可验证） */
  texture: number
  /** 平滑后接缝差 */
  trendMAD: number
  /** 片内自然步进基线 */
  baseline: number
  /** 结论文案 */
  reason: string
}

/**
 * 单条接缝裁决：
 * - 可验证性：任一侧边界带高频纹理能量不足（TEXTURE_MIN）→ 拒绝（平坦边缘无法证明连续）
 * - 连续性：低频成分（平滑后）的边界差 vs 片内相邻行/列的自然步进，比值 < 阈值才通过。
 *   高频纹理逐行天然去相关、不能作匹配信号，先平滑剔除；基线取各自片内相邻对
 *   （不可跨片比较，否则无关片间差异会稀释接缝信号）。
 */
function judgeSeam(edgeA: Float32Array, edgeB: Float32Array, dir: 'V' | 'H', from: number, to: number, innerPairs: () => [Float32Array, Float32Array][]): SeamVerdict {
  const texture = Math.max(std(residual(edgeA)), std(residual(edgeB)))
  const mk = (ok: boolean, score: number, reason: string, trendMAD = 0, baseline = 0): SeamVerdict =>
    ({ ok, score, dir, from, to, texture, trendMAD, baseline, reason })
  if (texture < TEXTURE_MIN) return mk(false, Infinity, `纹理能量 ${texture.toFixed(1)} < ${TEXTURE_MIN}，平坦边缘不可验证`)
  const sA = smooth(edgeA)
  const sB = smooth(edgeB)
  const pairs = innerPairs()
  const innerTrend = pairs.map(([p, q]) => mad(smooth(p), smooth(q)))
  const baseline = innerTrend.reduce((t, s) => t + s, 0) / innerTrend.length
  const trendRef = Math.max(baseline, MAD_FLOOR)
  const trendMAD = mad(sA, sB)
  const score = trendMAD / trendRef
  return mk(score < BOUNDARY_THRESH, score,
    score < BOUNDARY_THRESH
      ? `连续（趋势差 ${trendMAD.toFixed(1)} / 基线 ${trendRef.toFixed(1)} = ${score.toFixed(2)} < ${BOUNDARY_THRESH}，纹理 ${texture.toFixed(1)}）`
      : `不连续（趋势差 ${trendMAD.toFixed(1)} / 基线 ${trendRef.toFixed(1)} = ${score.toFixed(2)} ≥ ${BOUNDARY_THRESH}，纹理 ${texture.toFixed(1)}）`,
    trendMAD, baseline)
}

/** 垂直接缝：A 末行 vs B 首行（基线取各自片内相邻行对） */
function seamVerdictV(a: Buffer, b: Buffer, from: number, to: number): SeamVerdict {
  const r = grayRows(a)
  return judgeSeam(
    rowOf(a, r - 1),
    rowOf(b, 0),
    'V', from, to,
    () => [
      [rowOf(a, r - 2), rowOf(a, r - 1)],
      [rowOf(a, r - 3), rowOf(a, r - 2)],
      [rowOf(b, 1), rowOf(b, 0)],
      [rowOf(b, 2), rowOf(b, 1)],
    ],
  )
}

/** 水平接缝：A 末列 vs B 首列（基线取各自片内相邻列对） */
function seamVerdictH(a: Buffer, b: Buffer, from: number, to: number): SeamVerdict {
  return judgeSeam(
    colOf(a, GRAY_W - 1),
    colOf(b, 0),
    'H', from, to,
    () => [
      [colOf(a, GRAY_W - 2), colOf(a, GRAY_W - 1)],
      [colOf(a, GRAY_W - 3), colOf(a, GRAY_W - 2)],
      [colOf(b, 1), colOf(b, 0)],
      [colOf(b, 2), colOf(b, 1)],
    ],
  )
}

/** 内容验证：所有接缝（趋势+纹理）均通过才成立；接缝总数 ≥3 时允许至多一条
 *  「边界容差缝」（比值 ∈ [3,5)——平台独立重压缩的典型错位幅度；多条缝相互
 *  印证才可信，2 缝场景证据不足不放行；平坦不可验证缝不参与容差）。
 *  返回最大接缝比值与逐缝证据。 */
export function verifyLayout(layout: MergeLayout, grays: Buffer[]): { pass: boolean; score: number; seams: SeamVerdict[] } {
  const seams: SeamVerdict[] = []
  const n = grays.length
  if (layout.kind === 'v') {
    for (let i = 0; i + 1 < n; i++) seams.push(seamVerdictV(grays[i], grays[i + 1], i, i + 1))
  } else if (layout.kind === 'h') {
    for (let i = 0; i + 1 < n; i++) seams.push(seamVerdictH(grays[i], grays[i + 1], i, i + 1))
  } else {
    const { cols } = layout
    for (let i = 0; i < n; i++) {
      if (i % cols < cols - 1 && i + 1 < n) seams.push(seamVerdictH(grays[i], grays[i + 1], i, i + 1))
      if (i + cols < n) seams.push(seamVerdictV(grays[i], grays[i + cols], i, i + cols))
    }
  }
  if (!seams.length) return { pass: false, score: Infinity, seams }
  const worst = Math.max(...seams.map((v) => v.score))
  const failed = seams.filter((v) => !v.ok)
  const borderline = failed.filter((v) => v.score < BORDERLINE_THRESH)
  const pass = seams.every((v) => v.ok)
    || (seams.length >= BORDERLINE_MIN_SEAMS && borderline.length <= BORDERLINE_MAX && failed.length === borderline.length)
  return { pass, score: worst, seams }
}

/** 内容识别：候选布局逐一经接缝连续性验证，取通过者中比值最小的一个 */
export function detectMergeLayout(sizes: ImageSize[], grays: Buffer[]): MergeLayout | null {
  return pickMergeLayout(sizes, grays)?.layout ?? null
}

/** 布局名（日志用） */
export function layoutName(layout: MergeLayout): string {
  return layout.kind === 'grid' ? `网格 ${layout.cols}x${layout.rows}` : layout.kind === 'v' ? '竖堆（水平切分）' : '横拼（垂直切分）'
}

/**
 * 候选布局逐一验证并产出证据链；返回通过者中证据最强（worst 接缝比值最小）的一个。
 * 每次调用都会把逐候选、逐接缝的判定依据写入 debug 日志（含尺寸与灰度行数）。
 */
export function pickMergeLayout(sizes: ImageSize[], grays: Buffer[]): { layout: MergeLayout; score: number; seams: SeamVerdict[] } | null {
  const candidates = candidateLayouts(sizes.length, sizes)
  debugLog(`同源合并候选：${sizes.length} 张，尺寸 ${sizes.map((s) => `${s.width}x${s.height}`).join(' / ')}，灰度行数 ${grays.map((g) => grayRows(g)).join('/')}`)
  if (!candidates.length) {
    debugLog('同源合并候选：无（数量/尺寸组合不构成网格/竖堆/横拼任何可能）')
    return null
  }
  let best: { layout: MergeLayout; score: number; seams: SeamVerdict[] } | null = null
  for (const c of candidates) {
    const { pass, score, seams } = verifyLayout(c, grays)
    const tolerated = seams.filter((v) => !v.ok).length
    const detail = seams.map((v) =>
      `[${v.dir === 'V' ? '竖' : '横'}缝 ${v.from}→${v.to}] ${v.reason}`).join('；')
    debugLog(`同源合并证据·${layoutName(c)}：${pass ? '通过' : '拒绝'}${pass && tolerated ? `（含 ${tolerated} 条边界容差缝）` : ''}，worst=${score === Infinity ? '∞' : score.toFixed(2)} ⟶ ${detail}`)
    if (pass && (!best || score < best.score)) best = { layout: c, score, seams }
  }
  if (best) debugLog(`同源合并裁决：${layoutName(best.layout)}（证据最强，worst 接缝比值 ${best.score.toFixed(2)}）`)
  else debugLog('同源合并裁决：全部候选未通过内容验证 → 逐张发送')
  return best
}

/* ---------- ffmpeg 合并 ---------- */

/** xstack 均匀网格布局串（各片已统一缩放为 w×h，行优先） */
export function xstackLayout(cols: number, rows: number, w: number, h: number): string {
  const parts: string[] = []
  for (let i = 0; i < cols * rows; i++) {
    const x = (i % cols) * w
    const y = Math.floor(i / cols) * h
    parts.push(`${x}_${y}`)
  }
  return parts.join('|')
}

/** 生成 ffmpeg filter_complex（输出标签恒为 [out]，导出供测试） */
export function buildMergeFilter(n: number, layout: MergeLayout, sizes: ImageSize[]): string {
  const chains: string[] = []
  const stacks: string[] = []
  const chainOf = (stack: string, outW: number, outH: number): string => {
    if (outW > MAX_OUTPUT_SIDE || outH > MAX_OUTPUT_SIDE) {
      const scale = Math.min(1, MAX_OUTPUT_SIDE / Math.max(outW, outH))
      return `${stack}[tmp];[tmp]scale=${Math.round(outW * scale) / 2 * 2}:${Math.round(outH * scale) / 2 * 2}:flags=lanczos[out]`
    }
    return `${stack}[out]`
  }
  if (layout.kind === 'grid') {
    // 宫格拼图：各片等比缩放进统一格子（不足处黑边补齐——切片场景无补边，杂图集保持各自比例），
    // 逐片 concat 成帧序列后 tile 出宫格（支持非满宫格，如 7 图 3x3）
    const cellW = Math.min(Math.max(...sizes.map((s) => s.width)), 1920)
    const cellH = Math.min(Math.max(...sizes.map((s) => s.height)), 1920)
    const cw = Math.ceil(cellW / 2) * 2
    const ch = Math.ceil(cellH / 2) * 2
    for (let i = 0; i < n; i++) {
      chains.push(`[${i}:v]scale=${cw}:${ch}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${cw}:${ch}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[c${i}]`)
      stacks.push(`[c${i}]`)
    }
    chains.push(`${stacks.join('')}concat=n=${n}:v=1:a=0[frames]`)
    chains.push(chainOf(`[frames]tile=${layout.cols}x${layout.rows}`, layout.cols * cw, layout.rows * ch))
  } else if (layout.kind === 'v') {
    const w = Math.max(...sizes.map((s) => s.width))
    for (let i = 0; i < n; i++) chains.push(`[${i}:v]scale=${w}:-2:flags=lanczos[s${i}]`)
    for (let i = 0; i < n; i++) stacks.push(`[s${i}]`)
    chains.push(chainOf(`${stacks.join('')}vstack=inputs=${n}`, w, sizes.reduce((t, s) => t + s.height, 0)))
  } else {
    const h = Math.max(...sizes.map((s) => s.height))
    for (let i = 0; i < n; i++) chains.push(`[${i}:v]scale=-2:${h}:flags=lanczos[s${i}]`)
    for (let i = 0; i < n; i++) stacks.push(`[s${i}]`)
    chains.push(chainOf(`${stacks.join('')}hstack=inputs=${n}`, sizes.reduce((t, s) => t + s.width, 0), h))
  }
  return chains.join(';')
}

/** 按魔数给临时文件配扩展名（ffmpeg 也可自行探测，显式更稳） */
function extOf(buf: Buffer): string {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png'
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg'
  if (buf.toString('ascii', 0, 4) === 'RIFF') return 'webp'
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'gif'
  return 'bin'
}

const MERGE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function downloadImage(rt: ParserRuntimeLike, url: string): Promise<Buffer> {
  const headers: Record<string, string> = { 'User-Agent': MERGE_UA }
  headers['Referer'] = /twimg\.com/.test(url) ? 'https://twitter.com/' : 'https://www.baidu.com/'
  return rt.http.get(url, { responseType: 'arraybuffer', timeout: 30000, headers })
    .then((res: any) => Buffer.from(res.data))
}

/**
 * 下载 → 灰度解码 → 内容识别接缝 → 合并。
 * 不构成母图切片（接缝不连续）或任一环节失败 → null。
 */
export async function mergeImages(rt: ParserRuntimeLike, urls: string[]): Promise<{ buffer: Buffer; layout: MergeLayout } | null> {
  if (urls.length < 2 || urls.length > MAX_PIECES) return null
  let buffers: Buffer[]
  try {
    buffers = await Promise.all(urls.map((u) => downloadImage(rt, u)))
  } catch (e: any) {
    debugLog(`切图合并跳过（分片下载失败）：${e?.message || e}`)
    return null
  }
  const total = buffers.reduce((t, b) => t + b.length, 0)
  if (total > MAX_TOTAL_BYTES || buffers.some((b) => !b.length)) return null

  const sizes = buffers.map((b) => probeImageSize(b))
  if (sizes.some((s) => !s)) return null

  const dir = await mkdtemp(join(tmpdir(), `vpa-merge-${randomBytes(4).toString('hex')}-`))
  try {
    const files: string[] = []
    for (let i = 0; i < buffers.length; i++) {
      const f = join(dir, `${i}.${extOf(buffers[i])}`)
      await writeFile(f, buffers[i])
      files.push(f)
    }
    // 布局决策（完全由像素内容裁决，不依赖数量规则、链接/文件名与色调风格）：
    // 网格/竖堆/横拼三种布局候选（按尺寸可能性给出），逐一经接缝内容验证
    // （亮度趋势 + 去趋势纹理双通道、平坦边缘不可验证即拒绝），
    // 取通过者中证据最强（接缝比值最小）的一种——真 2x2/3x3 切片网格缝连续、
    // 长图条带单向连续、无关图全部不过；合并方式由内容区分，均不过则逐张发送
    let grays: Buffer[]
    try {
      grays = await Promise.all(files.map(toGray))
    } catch (e: any) {
      debugLog(`切图合并跳过（灰度解码失败）：${e?.message || e}`)
      return null
    }
    const picked = pickMergeLayout(sizes as ImageSize[], grays)
    if (!picked) return null
    const layout = picked.layout

    const filter = buildMergeFilter(files.length, layout, sizes as ImageSize[])
    const args = ['-hide_banner', '-loglevel', 'error', ...files.flatMap((f) => ['-i', f]),
      '-filter_complex', filter, '-map', '[out]', '-frames:v', '1', '-q:v', '2',
      '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1']
    const out = await new Promise<Buffer | null>((resolve) => {
      const child = spawn(resolveFfmpeg(), args)
      const chunks: Buffer[] = []
      child.stdout.on('data', (d: Buffer) => chunks.push(d))
      child.stderr.on('data', () => {})
      child.on('error', () => resolve(null))
      child.on('close', (code) => resolve(code === 0 && chunks.length ? Buffer.concat(chunks) : null))
    })
    if (!out) {
      debugLog(`切图合并失败（ffmpeg 退出非 0），回退逐张发送`)
      return null
    }
    const desc = layout.kind === 'grid' ? `${layout.cols}x${layout.rows} 宫格` : layout.kind === 'v' ? '垂直堆叠' : '水平拼接'
    logger.info(`同源切图已合并为一张（内容识别：${urls.length} 张 → ${desc}，${Math.round(out.length / 1024)}KB）`)
    return { buffer: out, layout }
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

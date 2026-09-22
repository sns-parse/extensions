/**
 * 审核结果缓存（内容寻址 + 磁盘持久化）。
 *
 * 缓存键 = sha256(图片字节)。完全不掺 URL：
 * 查询参数不同、短链接展开、镜像/CDN 域名差异的同内容图片天然命中同一键。
 * （送审前 gate 必先下载字节，buffer 恒可用）
 *
 * 持久化：<baseDir>/data/video-parser-all/moderation-cache.json，
 * 防抖落盘；文件头存 provider 配置签名（哈希），配置变更自动作废旧结果。
 * 未 init（CLI/测试）时退化为纯内存。
 */
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, resolve } from 'path'
import type { CheckInput, CheckResult } from './types'

const DISK_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 磁盘条目 7 天
const MAX_ENTRIES = 5000
const SAVE_DEBOUNCE_MS = 3000

interface Entry { nsfw: boolean; label: string; detail?: string; ts: number }

let file: string | null = null
let fileSig = ''
let saveTimer: NodeJS.Timeout | null = null
const store = new Map<string, Entry>()

/** 内容哈希：同字节 = 同图 = 同判定，与 URL 形态无关 */
export function contentHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

/** 初始化（含磁盘加载）。sig 为 provider 配置指纹（建议传哈希，避免落盘密钥） */
export function initModerationCache(baseDir: string | undefined, sig: string): void {
  store.clear()
  if (!baseDir) { file = null; return }
  file = resolve(baseDir, 'data', 'video-parser-all', 'moderation-cache.json')
  fileSig = sig
  try {
    if (!existsSync(file)) return
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (parsed?.sig !== fileSig || !Array.isArray(parsed.entries)) return // 配置已变，作废
    const now = Date.now()
    const valid = (parsed.entries as [string, Entry][]).filter(([, v]) => v?.ts && now - v.ts < DISK_TTL_MS)
    valid.sort((a, b) => b[1].ts - a[1].ts) // 新的在前
    for (const [k, v] of valid.slice(0, MAX_ENTRIES)) store.set(k, v)
  } catch { /* 文件损坏 → 空缓存起步 */ }
}

function pruneAndSerialize(): string {
  const now = Date.now()
  for (const [k, v] of store) if (now - v.ts >= DISK_TTL_MS) store.delete(k)
  while (store.size > MAX_ENTRIES) store.delete(store.keys().next().value as string)
  return JSON.stringify({ sig: fileSig, ts: now, entries: [...store.entries()] })
}

function saveNow(): void {
  if (!file) return
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, pruneAndSerialize(), 'utf8')
  } catch { /* 磁盘不可写 → 仅内存 */ }
}

function scheduleSave(): void {
  if (!file) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { saveTimer = null; saveNow() }, SAVE_DEBOUNCE_MS)
}

export function getCached(input: CheckInput): CheckResult | undefined {
  const e = store.get(contentHash(input.buffer))
  if (!e) return undefined
  if (Date.now() - e.ts >= DISK_TTL_MS) {
    store.delete(contentHash(input.buffer))
    return undefined
  }
  return { nsfw: e.nsfw, label: e.label, detail: e.detail }
}

export function setCached(input: CheckInput, result: CheckResult): void {
  store.set(contentHash(input.buffer), { nsfw: result.nsfw, label: result.label, detail: result.detail, ts: Date.now() })
  scheduleSave()
}

/** 立即落盘（dispose 时调用，保留持久化结果） */
export function flushModerationCache(): void {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  saveNow()
}

/** 清空（仅测试用；会连磁盘文件一起清） */
export function clearModerationCache(): void {
  store.clear()
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  saveNow()
}

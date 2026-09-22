/**
 * 图片尺寸探测（无依赖）：PNG / GIF / JPEG / WebP 头部解析。
 * 仅供同源切图识别用：只读宽高，不解码像素。
 */

export interface ImageSize {
  width: number
  height: number
}

/** 探测图片缓冲区尺寸；无法识别返回 null */
export function probeImageSize(buf: Buffer): ImageSize | null {
  if (!buf || buf.length < 12) return null
  // PNG: 89 50 4E 47 0D 0A 1A 0A，IHDR 宽高在 16..24
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    if (buf.length < 24) return null
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }
  // GIF: GIF8
  if (buf.toString('ascii', 0, 4) === 'GIF8') {
    if (buf.length < 10) return null
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
  }
  // JPEG: FF D8，扫描 SOF0/1/2/...（C0-CF，除 C4/C8/CC）段
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) { off++; continue }
      const marker = buf[off + 1]
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = buf.readUInt16BE(off + 5)
        const width = buf.readUInt16BE(off + 7)
        if (width && height) return { width, height }
        return null
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) { off += 2; continue }
      const segLen = buf.readUInt16BE(off + 2)
      if (segLen < 2) return null
      off += 2 + segLen
    }
    return null
  }
  // WebP: RIFF....WEBP
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const fourcc = buf.toString('ascii', 12, 16)
    if (fourcc === 'VP8 ' && buf.length >= 30) {
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
    }
    if (fourcc === 'VP8L' && buf.length >= 25) {
      const b = buf.readUInt32LE(21)
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }
    }
    if (fourcc === 'VP8X' && buf.length >= 30) {
      const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16))
      const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16))
      return { width: w, height: h }
    }
    return null
  }
  return null
}

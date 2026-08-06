// Tiny dependency-free PNG generator for the tray / window icon.
// Draws the Courseless mark: an ocean-blue rounded tile with a white "C" ring.
// (Programmatic so there is no binary asset to ship or lose.)

import { deflateSync } from 'node:zlib'

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/** Ocean-gradient rounded tile with a white C. Returns PNG bytes. */
export function courselessIconPng(size: number): Buffer {
  const rgba = Buffer.alloc(size * size * 4)
  const R = size * 0.22 // corner radius
  const cx = size / 2
  const cy = size / 2
  const outer = size * 0.345
  const inner = size * 0.205
  const gapHalfAngle = (38 * Math.PI) / 180
  const SS = 3 // supersampling

  const top: [number, number, number] = [0x0b, 0x29, 0x42]
  const bottom: [number, number, number] = [0x0b, 0x96, 0xea]

  const insideRounded = (x: number, y: number): boolean => {
    const dx = Math.max(R - x, 0, x - (size - R))
    const dy = Math.max(R - y, 0, y - (size - R))
    if (dx === 0 || dy === 0) return x >= 0 && y >= 0 && x <= size && y <= size
    return dx * dx + dy * dy <= R * R
  }

  const inC = (x: number, y: number): boolean => {
    const dx = x - cx
    const dy = y - cy
    const r = Math.hypot(dx, dy)
    if (r > outer || r < inner) return false
    const ang = Math.atan2(dy, dx) // 0 = right
    return Math.abs(ang) > gapHalfAngle
  }

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let cov = 0
      let glyph = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px + (sx + 0.5) / SS
          const y = py + (sy + 0.5) / SS
          if (insideRounded(x, y)) {
            cov++
            if (inC(x, y)) glyph++
          }
        }
      }
      const n = SS * SS
      const alpha = cov / n
      const g = glyph / n
      const base = mix(top, bottom, py / Math.max(1, size - 1))
      const col = mix(base, [255, 255, 255], alpha > 0 ? g / Math.max(alpha, 0.0001) : 0)
      const o = (py * size + px) * 4
      rgba[o] = Math.round(Math.max(0, Math.min(255, col[0])))
      rgba[o + 1] = Math.round(Math.max(0, Math.min(255, col[1])))
      rgba[o + 2] = Math.round(Math.max(0, Math.min(255, col[2])))
      rgba[o + 3] = Math.round(alpha * 255)
    }
  }
  return encodePng(size, size, rgba)
}

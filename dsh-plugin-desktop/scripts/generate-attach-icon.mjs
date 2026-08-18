/** Generate attach-mode window icons from the official DeepSeek Harness whale SVG. */

import { mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = join(root, 'build')
mkdirSync(buildDir, { recursive: true })

const svgPath = join(buildDir, 'dsh-whale.svg')
const sizes = [16, 32, 48, 64, 128, 256]

const pngBuffers = await Promise.all(
  sizes.map((size) => sharp(svgPath).resize(size, size).png().toBuffer()),
)

await writeFile(join(buildDir, 'attach-icon.png'), pngBuffers[sizes.indexOf(256)])

/** Pack PNG buffers into a multi-size ICO (Vista+ PNG-in-ICO layout). */
function buildIco(pngs, dims) {
  const count = pngs.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(count, 4)
  const entries = []
  let offset = 6 + 16 * count
  for (let index = 0; index < count; index++) {
    const dim = dims[index] ?? 0
    const png = pngs[index] ?? Buffer.alloc(0)
    const entry = Buffer.alloc(16)
    entry.writeUInt8(dim >= 256 ? 0 : dim, 0) // width (0 means 256)
    entry.writeUInt8(dim >= 256 ? 0 : dim, 1) // height
    entry.writeUInt8(0, 2) // color count
    entry.writeUInt8(0, 3) // reserved
    entry.writeUInt16LE(1, 4) // color planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(png.length, 8) // data size
    entry.writeUInt32LE(offset, 12) // data offset
    entries.push(entry)
    offset += png.length
  }
  return Buffer.concat([header, ...entries, ...pngs])
}

await writeFile(join(buildDir, 'attach-icon.ico'), buildIco(pngBuffers, sizes))
console.log(`generated build/attach-icon.png and build/attach-icon.ico (${sizes.join('/')}px)`)

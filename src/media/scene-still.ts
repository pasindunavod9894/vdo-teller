import path from 'node:path'
import sharp from 'sharp'

/**
 * A full-scene still WITH the character in it (what the video model needs as its starting frame): the character's standing
 * pose placed on the background plate with a soft contact shadow. Done locally with sharp, so it costs nothing; the vision
 * gate then checks the result before any video money is spent.
 */
export async function compositeScene(opts: { assetsDir: string; plate: string; character: string; out: string; width?: number; height?: number }): Promise<string> {
  const W = opts.width ?? 1080
  const H = opts.height ?? 1920
  const bg = await sharp(path.join(opts.assetsDir, opts.plate)).resize(W, H, { fit: 'cover' }).toBuffer()
  const targetW = Math.round(W * 0.7)
  const body = await sharp(path.join(opts.assetsDir, opts.character)).trim().resize({ width: targetW, height: Math.round(H * 0.6), fit: 'inside' }).toBuffer()
  const meta = await sharp(body).metadata()
  const bw = meta.width ?? targetW
  const bh = meta.height ?? Math.round(H * 0.5)
  const left = Math.round((W - bw) / 2)
  const top = Math.round(H * 0.9 - bh)
  const shadow = await sharp({ create: { width: Math.round(bw * 0.8), height: 46, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.35 } } })
    .blur(14).png().toBuffer()
  await sharp(bg)
    .composite([
      { input: shadow, left: Math.round((W - bw * 0.8) / 2), top: Math.round(H * 0.9 - 22) },
      { input: body, left, top },
    ])
    .png().toFile(path.join(opts.assetsDir, opts.out))
  return opts.out
}

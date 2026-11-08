/* Generates "talking" frames as edits of ONE steady face, so only the mouth changes (no eye/brow flicker).
 * Costs ~$0.05 per image (medium). Cached in render/proof/assets. Run:
 *   pnpm tsx --env-file=.env scripts/gen-talk-frames.ts [names...]     (default: slightly-open)
 */
import fs from 'node:fs'
import path from 'node:path'
import OpenAI, { toFile } from 'openai'
import sharp from 'sharp'
import { normalizeBusts, writeBusts } from '../src/engine/assets'
import { stylePrompt } from '../src/lib/styles/prompts'

const assets = path.resolve('render/proof/assets')
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const MOUTHS: Record<string, string> = {
  'slightly-open': 'mouth slightly open, as if starting to speak',
  'round-oh': 'mouth in a small round "oh" shape',
  'wide-open': 'mouth wide open, as if speaking loudly',
}

async function main() {
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const names = wanted.length ? wanted : ['slightly-open']
  const base = path.join(assets, 'mouth-closed-n.png') // the steady face: neutral eyes, mouth closed
  if (!fs.existsSync(base)) throw new Error('Run the proof script once first (needs mouth-closed-n.png)')
  const baseBuf = fs.readFileSync(base)
  for (const n of names) {
    const out = path.join(assets, `talk-${n}.png`)
    if (fs.existsSync(out)) { console.log('cached', n); continue }
    const r = await client.images.edit({
      model: 'gpt-image-1.5', image: await toFile(baseBuf, 'base.png', { type: 'image/png' }),
      prompt: `Edit this exact image: change ONLY the cat's mouth to: ${MOUTHS[n]}. Everything else must stay identical: same eyes, eyebrows, ears, chef hat, scarf, fur, head position and size, lighting and framing. Art style: ${stylePrompt('pixar-3d')}. Transparent background.`,
      background: 'transparent', input_fidelity: 'high', output_format: 'png', size: '1024x1024', quality: 'medium',
    })
    fs.writeFileSync(out, Buffer.from(r.data![0].b64_json!, 'base64'))
    console.log('made  ', n, '(~$0.05)')
  }
  // measure: how much does the UPPER face (eyes, brows, ears, hat) differ from the base? lower = steadier
  const upperDiff = async (a: Buffer, b: Buffer) => {
    const ra = await sharp(a).resize(512, 512, { fit: 'fill' }).ensureAlpha().raw().toBuffer()
    const rb = await sharp(b).resize(512, 512, { fit: 'fill' }).ensureAlpha().raw().toBuffer()
    let sum = 0, cnt = 0
    for (let y = 0; y < 256; y++) for (let x = 0; x < 512; x++) { const i = (y * 512 + x) * 4; if (ra[i + 3] > 40 && rb[i + 3] > 40) { sum += Math.abs(ra[i] - rb[i]) + Math.abs(ra[i + 1] - rb[i + 1]) + Math.abs(ra[i + 2] - rb[i + 2]); cnt++ } }
    return sum / Math.max(1, cnt) / 3
  }
  const baseResized = await sharp(baseBuf).resize(1024, 1024, { fit: 'fill' }).png().toBuffer()
  const oldVariant = await sharp(path.join(assets, 'mouth-slightly-open-n.png')).resize(1024, 1024, { fit: 'fill' }).png().toBuffer()
  console.log('upper-face difference vs steady face (0 = identical):')
  console.log('  OLD  separately generated mouth image:', (await upperDiff(baseResized, oldVariant)).toFixed(1))
  for (const n of names) {
    const v = await sharp(path.join(assets, `talk-${n}.png`)).png().toBuffer()
    console.log(`  NEW  edit of the steady face (${n}):`, (await upperDiff(baseResized, v)).toFixed(1))
  }
  void writeBusts; void normalizeBusts
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })

/* Extra art for LIVE movement (walk cycle, jump, blink, remaining mouth shapes). ~$0.05 per image, cached, hard budget guard.
 *   pnpm tsx --env-file=.env scripts/gen-motion-assets.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import OpenAI, { toFile } from 'openai'
import { stylePrompt } from '../src/lib/styles/prompts'

const BUDGET = 0.4
const PER_IMAGE = 0.05
const assets = path.resolve('render/proof/assets')
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const look = stylePrompt('pixar-3d')
const CHARACTER = 'Young orange tabby cat with darker stripes, round expressive green eyes, cream muzzle and chest, stocky build, wearing a rumpled green scarf and a small white chef hat.'
const KEEP = 'Single character on a fully transparent background. No ground, no glow, no text, no extra objects. The whole character is fully inside the frame with a clear margin on every side. Preserve the exact eye colour, fur pattern, proportions, scarf and chef hat from the reference image.'

let spent = 0
async function make(name: string, create: () => Promise<string>) {
  const out = path.join(assets, name)
  if (fs.existsSync(out)) { console.log('cached', name); return }
  if (spent + PER_IMAGE > BUDGET) throw new Error(`Budget guard: stopping before ${name}`)
  for (let attempt = 1; ; attempt++) {
    try { fs.writeFileSync(out, Buffer.from(await create(), 'base64')); break } catch (e) {
      const status = (e as { status?: number }).status
      const retry = status === 429 || status === 500 || status === 502 || /safety system/i.test((e as Error).message)
      if (!retry || attempt >= 4) throw new Error(`${name}: ${(e as Error).message}`)
      console.log(`  retry ${attempt} (${status ?? 'safety filter'})`); await new Promise((r) => setTimeout(r, status === 429 ? 20000 : 3000))
    }
  }
  spent += PER_IMAGE
  console.log(`made   ${name}  (spent ~$${spent.toFixed(2)})`)
}

async function main() {
  const ref = fs.readFileSync(path.join(assets, 'ref-sheet.png'))
  const base = fs.readFileSync(path.join(assets, 'mouth-closed-n.png'))
  const fromRef = (prompt: string) => async () => {
    const r = await client.images.edit({ model: 'gpt-image-1.5', image: await toFile(ref, 'ref.png', { type: 'image/png' }), prompt: `${prompt} ${KEEP} Character: ${CHARACTER} Art style: ${look}.`, background: 'transparent', input_fidelity: 'high', output_format: 'png', size: '1024x1024', quality: 'medium' })
    return r.data![0].b64_json!
  }
  const fromBase = (prompt: string) => async () => {
    const r = await client.images.edit({ model: 'gpt-image-1.5', image: await toFile(base, 'base.png', { type: 'image/png' }), prompt: `Edit this exact image: ${prompt} Everything else must stay identical: same eyes, eyebrows, ears, chef hat, scarf, fur, head position and size, lighting and framing. Art style: ${look}. Transparent background.`, background: 'transparent', input_fidelity: 'high', output_format: 'png', size: '1024x1024', quality: 'medium' })
    return r.data![0].b64_json!
  }

  // full-body poses for the walk cycle and the jump
  await make('body-walk-a.png', fromRef('Pose: walking to the right, side view, mid-stride, the front-left leg forward and the back-right leg behind, full body.'))
  await make('body-walk-b.png', fromRef('Pose: walking to the right, side view, mid-stride, the OPPOSITE stride: the front-right leg forward and the back-left leg behind, full body.'))
  await make('body-crouch.png', fromRef('Pose: crouching low, front view, knees bent, body compressed like a spring about to jump, full body.'))
  await make('body-air.png', fromRef('Pose: jumping high in the air, front view, legs tucked and arms spread, startled wide eyes, full body, no ground.'))
  // face edits of the steady base: only the mouth / eyes change
  await make('talk-round-oh.png', fromBase('change ONLY the cat\'s mouth to a small round "oh" shape.'))
  await make('talk-wide-open.png', fromBase('change ONLY the cat\'s mouth to wide open, as if speaking loudly.'))
  await make('talk-blink.png', fromBase('change ONLY the eyes to closed, as in a natural blink (eyelids shut, no visible irises); keep the mouth closed.'))
  console.log(`Spent this run: ~$${spent.toFixed(2)} (estimate)`)
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })

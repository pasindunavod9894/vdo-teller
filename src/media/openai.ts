import fs from 'node:fs'
import path from 'node:path'
import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import { z } from 'zod'
import { tokenCostUsd } from '../agents/models'
import { tokenOptimization } from '../agents/optimization'
import sharp from 'sharp'
import { IMAGE_COST, type Quality } from '../lib/art/plan'
import { probeDuration } from '../providers/video/fal'
import { transcribeWords } from '../engine/transcribe'
import type { MediaServices, SpeechSpec } from './types'
import { hashOf, safeName } from './workspace'

/** Real media makers (plan phase 9). Costs money: use only when MEDIA_PROVIDER=openai and the series cap allows it. */
export const SPEECH_USD_PER_MIN = 0.015
export const WHISPER_USD_PER_MIN = 0.006

const GateSchema = z.object({ pass: z.boolean(), notes: z.string().describe('one short sentence: what is wrong, or "ok"') })

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try { return await fn() } catch (e) {
      const status = (e as { status?: number }).status
      const retryable = status === 429 || (status !== undefined && status >= 500) || /safety system/i.test((e as Error).message)
      if (!retryable || attempt >= 3) throw new Error(`${label} failed: ${(e as Error).message}`)
      await new Promise((r) => setTimeout(r, status === 429 ? 15000 : 2500))
    }
  }
}

export function createOpenAIMedia(opts: { assetsDir: string; libraryDir: string; client?: OpenAI; gateModel?: string; /** image quality follows the tier: draft quality is far cheaper (plan §3b) */ quality?: Quality }): MediaServices {
  const quality: Quality = opts.quality ?? 'medium'
  const client = opts.client ?? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const gateModel = opts.gateModel ?? process.env.OPENAI_MODEL_GATE ?? 'gpt-5-mini'
  return {
    provider: 'openai',
    assetsDir: opts.assetsDir,

    async plate({ key, prompt }) {
      const name = `plate-${safeName(key)}.png`
      const lib = path.join(opts.libraryDir, name)
      if (fs.existsSync(lib)) { fs.copyFileSync(lib, path.join(opts.assetsDir, name)); return { file: name, costUsd: 0, cached: true } }
      const r = await withRetry(`plate ${key}`, () => client.images.generate({ model: 'gpt-image-2', prompt, size: '1024x1536', quality, n: 1 }))
      const b64 = r.data?.[0]?.b64_json
      if (!b64) throw new Error(`plate ${key}: the image service returned nothing`)
      fs.writeFileSync(lib, Buffer.from(b64, 'base64'))
      fs.copyFileSync(lib, path.join(opts.assetsDir, name))
      return { file: name, costUsd: IMAGE_COST[quality], cached: false }
    },

    async speech(spec: SpeechSpec) {
      const id = hashOf(spec.voice, spec.instructions ?? '', spec.text)
      const name = `speech-${safeName(spec.name)}-${id}.wav`
      const dest = path.join(opts.assetsDir, name)
      const wordsFile = `${dest}.words.json`
      let newSpend = 0
      // a line that was already made for this series (an earlier attempt or episode) comes back from the library for free
      const lib = path.join(opts.libraryDir, name)
      const reuse = tokenOptimization()
      if (reuse && !fs.existsSync(dest) && fs.existsSync(lib) && fs.existsSync(`${lib}.words.json`)) { fs.copyFileSync(lib, dest); fs.copyFileSync(`${lib}.words.json`, wordsFile) }
      if (!fs.existsSync(dest)) {
        const r = await withRetry(`speech ${spec.name}`, () => client.audio.speech.create({ model: 'gpt-4o-mini-tts', voice: spec.voice, input: spec.text, instructions: spec.instructions, response_format: 'wav' }))
        fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()))
      }
      const seconds = await probeDuration(dest)
      if (!fs.existsSync(wordsFile)) {
        const words = await withRetry(`word timing ${spec.name}`, () => transcribeWords(dest, client))
        fs.writeFileSync(wordsFile, JSON.stringify(words))
        newSpend = (seconds / 60) * (SPEECH_USD_PER_MIN + WHISPER_USD_PER_MIN)
      }
      if (reuse && !fs.existsSync(lib)) { fs.copyFileSync(dest, lib); fs.copyFileSync(wordsFile, `${lib}.words.json`) }
      return { file: name, seconds, words: JSON.parse(fs.readFileSync(wordsFile, 'utf8')), costUsd: Math.round(newSpend * 10000) / 10000 }
    },

    async gate(file, rules) {
      // a small JPEG is all a quick check needs: a fraction of the upload, and the vision cost is the same low-detail price
      // optimization off: the original image is sent as it is
      const small = tokenOptimization()
      const buf = small ? await sharp(fs.readFileSync(file)).resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer() : fs.readFileSync(file)
      const mime = small ? 'image/jpeg' : 'image/png'
      const res = await withRetry('quality check', () => client.responses.parse({
        model: gateModel, reasoning: { effort: 'minimal' },
        instructions: 'You check generated images for an animation studio. Judge ONLY against the rules you are given. Be strict about the listed problems and ignore everything else.',
        input: [{ role: 'user', content: [
          { type: 'input_text', text: `Rules: ${rules}\nDoes the image pass?` },
          { type: 'input_image', image_url: `data:${mime};base64,${buf.toString('base64')}`, detail: 'low' },
        ] }],
        text: { format: zodTextFormat(GateSchema, 'gate'), verbosity: 'low' }, max_output_tokens: 600,
      }))
      const out = res.output_parsed
      if (!out) throw new Error('quality check returned no result')
      const u = res.usage
      const costUsd = u ? tokenCostUsd(gateModel, { inputTokens: u.input_tokens, cachedTokens: u.input_tokens_details?.cached_tokens ?? 0, outputTokens: u.output_tokens }) : 0.001
      return { pass: out.pass, notes: out.notes, costUsd }
    },
  }
}

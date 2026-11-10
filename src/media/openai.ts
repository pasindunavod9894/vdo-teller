import fs from 'node:fs'
import path from 'node:path'
import OpenAI, { toFile } from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import { z } from 'zod'
import { MODELS, tokenCostUsd } from '../agents/models'
import { REEL_QA_INSTRUCTIONS } from '../agents/prompts'
import { ReelQaSchema } from '../pipeline/schemas'
import { tokenOptimization } from '../agents/optimization'
import { IMAGE_COST, KEYFRAME_QUALITY, REFERENCE_QUALITY } from '../lib/art/plan'
import { runCapture } from '../engine/ffmpeg'
import { probeDuration } from '../providers/video/fal'
import { transcribeWords } from '../engine/transcribe'
import type { MediaServices, SpeechSpec } from './types'
import { hashOf, safeName } from './workspace'

/** Real media makers (plan phase 9). Costs money: use only when MEDIA_PROVIDER=openai and the series cap allows it. */
export const SPEECH_USD_PER_MIN = 0.015
export const WHISPER_USD_PER_MIN = 0.006

const GateSchema = z.object({ pass: z.boolean(), notes: z.string().describe('one short sentence: what is wrong, or "ok"') })

const ContinuitySchema = z.object({
  characters: z.array(z.object({
    name: z.string().describe('the character name exactly as given'),
    sameIdentity: z.number().describe('0 to 1: how sure you are that every frame shows this exact character (face shape, colours, markings, proportions, outfit)'),
    driftStartFraction: z.number().nullable().describe('0 to 1: how far into the clip (first frame = 0, last frame = 1) the character first looks different from its reference; null if it never does'),
    issues: z.array(z.string()).describe('short phrases, empty when the character is consistent'),
  })),
  undeclaredCharacters: z.array(z.string()).describe('any person or animal with a face in the frames that is not one of the named characters; empty if none'),
})

/** A request that never got an answer (dropped connection, timeout, reset): no HTTP status, and worth trying again. */
export const isConnectionError = (e: unknown): boolean =>
  e instanceof OpenAI.APIConnectionError || (((e as { status?: number })?.status) === undefined && /connection error|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed/i.test((e as Error)?.message ?? ''))

export async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try { return await fn() } catch (e) {
      const status = (e as { status?: number }).status
      const retryable = status === 429 || (status !== undefined && status >= 500) || isConnectionError(e) || /safety system/i.test((e as Error).message)
      if (!retryable || attempt >= 3) throw new Error(`${label} failed: ${(e as Error).message}`)
      await new Promise((r) => setTimeout(r, status === 429 ? 15000 : 2500))
    }
  }
}

/** A small JPEG of an image (or the first frame of a video): a fraction of the upload for a quick vision check. */
async function smallJpeg(file: string, max = 512): Promise<Buffer> {
  const { stdout } = await runCapture(['-v', 'error', '-i', file, '-vf', `scale='min(${max},iw)':'min(${max},ih)':force_original_aspect_ratio=decrease`, '-frames:v', '1', '-q:v', '5', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-'])
  if (!stdout.length) throw new Error(`Could not read the image ${file}`)
  return stdout
}

const dataUrl = (buf: Buffer, mime: string) => `data:${mime};base64,${buf.toString('base64')}`

export function createOpenAIMedia(opts: { assetsDir: string; libraryDir: string; client?: OpenAI; gateModel?: string }): MediaServices {
  const client = opts.client ?? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const gateModel = opts.gateModel ?? process.env.OPENAI_MODEL_GATE ?? 'gpt-5-mini'
  const visionCost = (model: string, u: OpenAI.Responses.ResponseUsage | undefined, fallback: number) =>
    u ? tokenCostUsd(model, { inputTokens: u.input_tokens, cachedTokens: u.input_tokens_details?.cached_tokens ?? 0, outputTokens: u.output_tokens }) : fallback

  return {
    provider: 'openai',
    assetsDir: opts.assetsDir,

    async plate({ key, prompt }) {
      const name = `plate-${safeName(key)}.png`
      const lib = path.join(opts.libraryDir, name)
      if (fs.existsSync(lib)) { fs.copyFileSync(lib, path.join(opts.assetsDir, name)); return { file: name, costUsd: 0, cached: true } }
      const r = await withRetry(`plate ${key}`, () => client.images.generate({ model: 'gpt-image-2', prompt, size: '1024x1536', quality: KEYFRAME_QUALITY, n: 1 }))
      const b64 = r.data?.[0]?.b64_json
      if (!b64) throw new Error(`plate ${key}: the image service returned nothing`)
      fs.writeFileSync(lib, Buffer.from(b64, 'base64'))
      fs.copyFileSync(lib, path.join(opts.assetsDir, name))
      return { file: name, costUsd: IMAGE_COST[KEYFRAME_QUALITY], cached: false }
    },

    async keyframe({ key, prompt, references }) {
      const name = `keyframe-${safeName(key)}.png`
      const images = await Promise.all(references.map((f) => toFile(fs.readFileSync(path.join(opts.assetsDir, f)), f, { type: 'image/png' })))
      const r = await withRetry(`keyframe ${key}`, () => client.images.edit({ model: 'gpt-image-2', image: images, prompt, size: '1024x1536', quality: KEYFRAME_QUALITY, n: 1 }))
      const b64 = r.data?.[0]?.b64_json
      if (!b64) throw new Error(`keyframe ${key}: the image service returned nothing`)
      fs.writeFileSync(path.join(opts.assetsDir, name), Buffer.from(b64, 'base64'))
      return { file: name, costUsd: IMAGE_COST[KEYFRAME_QUALITY] }
    },

    async reference({ key, prompt }) {
      const name = `ref-${safeName(key)}.png`
      const lib = path.join(opts.libraryDir, name)
      if (fs.existsSync(lib)) { fs.copyFileSync(lib, path.join(opts.assetsDir, name)); return { file: name, costUsd: 0, cached: true } }
      const r = await withRetry(`reference ${key}`, () => client.images.generate({ model: 'gpt-image-2', prompt, size: '1024x1024', quality: REFERENCE_QUALITY, n: 1 }))
      const b64 = r.data?.[0]?.b64_json
      if (!b64) throw new Error(`reference ${key}: the image service returned nothing`)
      fs.writeFileSync(lib, Buffer.from(b64, 'base64'))
      fs.copyFileSync(lib, path.join(opts.assetsDir, name))
      return { file: name, costUsd: IMAGE_COST[REFERENCE_QUALITY], cached: false }
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

    async gate(file, rules, references = []) {
      // a small JPEG is all a quick check needs: a fraction of the upload, and the vision cost is the same low-detail price
      // optimization off: the keyframe is sent as the full original image
      const small = tokenOptimization()
      const image = small ? { buf: await smallJpeg(file), mime: 'image/jpeg' } : { buf: fs.readFileSync(file), mime: 'image/png' }
      const content: OpenAI.Responses.ResponseInputContent[] = [{ type: 'input_text', text: `Rules: ${rules}\nDoes the LAST image pass?` }]
      for (const ref of references) {
        content.push({ type: 'input_text', text: `Reference image of the character ${ref.name} (the character in the last image must look exactly like this):` })
        content.push({ type: 'input_image', image_url: dataUrl(await smallJpeg(ref.file), 'image/jpeg'), detail: 'low' })
      }
      content.push({ type: 'input_text', text: 'The image to check:' }, { type: 'input_image', image_url: dataUrl(image.buf, image.mime), detail: 'low' })
      const res = await withRetry('quality check', () => client.responses.parse({
        model: gateModel, reasoning: { effort: 'minimal' },
        instructions: 'You check generated images for an animation studio. Judge ONLY against the rules you are given. Be strict about the listed problems and ignore everything else.',
        input: [{ role: 'user', content }],
        text: { format: zodTextFormat(GateSchema, 'gate'), verbosity: 'low' }, max_output_tokens: 600,
      }))
      const out = res.output_parsed
      if (!out) throw new Error('quality check returned no result')
      return { pass: out.pass, notes: out.notes, costUsd: visionCost(gateModel, res.usage, 0.001) }
    },

    async reelQa({ sheetFile, shots }) {
      const model = MODELS.reelQa
      const content: OpenAI.Responses.ResponseInputContent[] = [
        { type: 'input_text', text: `The contact sheet has ${shots.length} frames, left to right, one per shot, in this order of shot numbers: ${shots.join(', ')}. Report on each shot by its number.` },
        { type: 'input_image', image_url: dataUrl(await smallJpeg(sheetFile, 1800), 'image/jpeg'), detail: 'high' },
      ]
      const res = await withRetry('reel check', () => client.responses.parse({
        model, reasoning: { effort: 'minimal' }, instructions: REEL_QA_INSTRUCTIONS, input: [{ role: 'user', content }],
        text: { format: zodTextFormat(ReelQaSchema, 'reel_qa'), verbosity: 'low' }, max_output_tokens: 1500,
      }))
      const out = res.output_parsed
      if (!out) throw new Error('reel check returned no result')
      const known = new Set(shots)
      // only shots that exist, only real problems; the model's words are kept short
      const flags = out.shots.filter((s) => !s.ok && known.has(s.n)).map((s) => ({ shot: s.n, kind: s.kind, issue: s.issue.replace(/\s+/g, ' ').trim().slice(0, 160) || 'needs a look' }))
      return { flags, costUsd: visionCost(model, res.usage, 0.004) }
    },

    async continuity({ sheetFile, characters, clipSeconds }) {
      const model = MODELS.continuity
      const content: OpenAI.Responses.ResponseInputContent[] = [{
        type: 'input_text',
        text: `Named characters: ${characters.map((c) => c.name).join(', ')}. First come one reference image per character, then ONE contact sheet: evenly spaced frames of a short video clip, left to right, in time order. For every named character that appears in the frames, judge whether it is still exactly the same character as its reference in every frame (face shape, eye colour, fur or skin pattern and markings, proportions, outfit, accessories), and say how far into the clip it first looks different. Also list any person or animal with a face that is NOT one of the named characters.`,
      }]
      for (const c of characters) {
        content.push({ type: 'input_text', text: `Reference: ${c.name}` }, { type: 'input_image', image_url: dataUrl(await smallJpeg(c.reference, 768), 'image/jpeg'), detail: 'low' })
      }
      content.push({ type: 'input_text', text: 'Contact sheet of the clip:' }, { type: 'input_image', image_url: dataUrl(await smallJpeg(sheetFile, 1600), 'image/jpeg'), detail: 'high' })
      const res = await withRetry('continuity check', () => client.responses.parse({
        model, reasoning: { effort: 'minimal' },
        instructions: 'You are the continuity supervisor of an animation studio. Be strict: any change of face, colours, markings, proportions or outfit between frames counts as drift. Do not judge pose, expression or camera angle.',
        input: [{ role: 'user', content }],
        text: { format: zodTextFormat(ContinuitySchema, 'continuity'), verbosity: 'low' }, max_output_tokens: 1200,
      }))
      const out = res.output_parsed
      if (!out) throw new Error('continuity check returned no result')
      const byName = new Map(out.characters.map((c) => [c.name.toLowerCase(), c]))
      return {
        // a character the checker did not mention is treated as unverified, not as fine
        characters: characters.map((c) => {
          const r = byName.get(c.name.toLowerCase())
          return r
            ? { name: c.name, sameIdentity: Math.max(0, Math.min(1, r.sameIdentity)), driftStartSec: r.driftStartFraction == null ? null : Math.round(Math.max(0, Math.min(1, r.driftStartFraction)) * clipSeconds * 100) / 100, issues: r.issues }
            : { name: c.name, sameIdentity: 0, driftStartSec: 0, issues: ['not found in the frames'] }
        }),
        undeclaredCharacters: out.undeclaredCharacters,
        costUsd: visionCost(model, res.usage, 0.003),
      }
    },
  }
}

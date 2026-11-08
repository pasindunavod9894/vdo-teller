import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { alignBodies, normalizeBusts } from '../engine/assets'
import { buildPatchOverlay, buildTalkingFrames } from '../engine/talk'
import { hashOf, safeName } from './workspace'

/**
 * A character kit: every image the engine needs to animate one character, with file names inside an assets folder.
 * Built once per character (from its reference sheet) and reused by every episode.
 */
export type CharacterKit = {
  name: string
  stand: string
  walk: [string, string]
  crouch: string
  air: string
  /** one steady face, four mouth shapes: closed, slightly open, round "oh", wide open */
  face: [string, string, string, string]
  blink: string
  emotions: Record<string, string>
}

/** Local files a kit is built from. Body poses and the busts come from the reference sheet; mouths and blink are edits of the steady face. */
export type KitSources = {
  stand: string; walkA: string; walkB: string; crouch: string; air: string
  closed: string; happy: string; surprised: string; smug: string
  slightlyOpen: string; roundOh: string; wideOpen: string; blink: string
}

/** The kit's emotion busts (the others in the pack are optional). */
export const KIT_EMOTIONS = ['happy', 'surprised', 'smug'] as const

/**
 * Assembles the kit: bodies sit on one foot baseline, the close-ups share one head size and position, and the talking
 * frames are the steady face with only the mouth patched in, so nothing but the mouth moves while a character speaks.
 * Needs the SAME normalisation the edits were generated from (`normalizedBase`), which is deterministic.
 */
export async function buildKit(src: KitSources, outDir: string, name: string): Promise<CharacterKit> {
  fs.mkdirSync(outDir, { recursive: true })
  const n = safeName(name)
  const put = (file: string, data: Buffer) => { fs.writeFileSync(path.join(outDir, file), data); return file }

  const bodies = await alignBodies([['stand', src.stand], ['walk-a', src.walkA], ['walk-b', src.walkB], ['crouch', src.crouch], ['air', src.air]].map(([k, f]) => ({ name: k, file: f })))
  const body = Object.fromEntries(bodies.map((b) => [b.name, put(`${n}-body-${b.name}.png`, b.data)]))

  const busts = await normalizedBusts({ closed: src.closed, happy: src.happy, surprised: src.surprised, smug: src.smug })
  const bust = Object.fromEntries(busts.map((b) => [b.name, put(`${n}-bust-${b.name}.png`, b.data)]))

  const baseFile = path.join(outDir, bust.closed)
  const frames = await buildTalkingFrames(baseFile, [
    { name: 'face-1', file: src.slightlyOpen }, { name: 'face-2', file: src.roundOh }, { name: 'face-3', file: src.wideOpen },
  ])
  const face0 = put(`${n}-face-0.png`, await sharp(baseFile).resize(1024, 1024, { fit: 'fill' }).png().toBuffer())
  const faceN = frames.map((f) => put(`${n}-${f.name}.png`, f.data))
  const blink = put(`${n}-face-blink.png`, await buildPatchOverlay(baseFile, src.blink, 'eyes'))

  return {
    name,
    stand: body.stand, walk: [body['walk-a'], body['walk-b']], crouch: body.crouch, air: body.air,
    face: [face0, faceN[0], faceN[1], faceN[2]], blink,
    emotions: { happy: bust.happy, surprised: bust.surprised, smug: bust.smug },
  }
}

/** The group normalisation of the close-ups. Deterministic, so generation and assembly agree on the same steady base. */
export async function normalizedBusts(files: { closed: string; happy: string; surprised: string; smug: string }) {
  return normalizeBusts(Object.entries(files).map(([name, file]) => ({ name, file })))
}

/** Every file a kit refers to (for copying into an episode workspace). */
export function kitFiles(k: CharacterKit): string[] {
  return [k.stand, ...k.walk, k.crouch, k.air, ...k.face, k.blink, ...Object.values(k.emotions)]
}

export function copyKit(k: CharacterKit, fromDir: string, toDir: string): CharacterKit {
  fs.mkdirSync(toDir, { recursive: true })
  for (const f of kitFiles(k)) if (path.resolve(fromDir, f) !== path.resolve(toDir, f)) fs.copyFileSync(path.join(fromDir, f), path.join(toDir, f))
  return k
}

// ---------------------------------------------------------------------------------------------------------------------
// Free placeholder kit: simple vector cats with the same file roles. Lets the whole pipeline run with no spending.
// ---------------------------------------------------------------------------------------------------------------------

const mouthSvg = (m: number, cx: number, cy: number) => [
  `<path d="M ${cx - 40} ${cy} Q ${cx} ${cy + 18} ${cx + 40} ${cy}" stroke="#5a2a14" stroke-width="6" fill="none" stroke-linecap="round"/>`,
  `<ellipse cx="${cx}" cy="${cy + 8}" rx="24" ry="12" fill="#5a1d1d"/>`,
  `<circle cx="${cx}" cy="${cy + 12}" r="22" fill="#5a1d1d"/>`,
  `<ellipse cx="${cx}" cy="${cy + 20}" rx="46" ry="38" fill="#5a1d1d"/><ellipse cx="${cx}" cy="${cy + 38}" rx="28" ry="14" fill="#e0707a"/>`,
][m]

function headSvg(fur: string, eyes: 'open' | 'closed' | 'wide' | 'half', m: number, cx = 512, cy = 470) {
  const eye = (d: number) => {
    const x = cx + d * 100, y = cy - 20
    if (eyes === 'closed') return `<path d="M ${x - 36} ${y + 6} Q ${x} ${y + 26} ${x + 36} ${y + 6}" stroke="#2a1608" stroke-width="10" fill="none" stroke-linecap="round"/>`
    const r = eyes === 'wide' ? 44 : 34
    const lid = eyes === 'half' ? `<rect x="${x - r - 4}" y="${y - r * 1.2}" width="${r * 2 + 8}" height="${r * 1.0}" fill="${fur}"/>` : ''
    return `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 1.15}" fill="#fff"/><circle cx="${x}" cy="${y + 4}" r="${r * 0.55}" fill="#2a1608"/><circle cx="${x + 8}" cy="${y - 6}" r="${r * 0.2}" fill="#fff"/>${lid}`
  }
  return `
  <polygon points="${cx - 210},${cy - 100} ${cx - 170},${cy - 260} ${cx - 60},${cy - 170}" fill="${fur}"/>
  <polygon points="${cx + 210},${cy - 100} ${cx + 170},${cy - 260} ${cx + 60},${cy - 170}" fill="${fur}"/>
  <ellipse cx="${cx}" cy="${cy}" rx="240" ry="210" fill="${fur}"/>
  <ellipse cx="${cx}" cy="${cy + 90}" rx="100" ry="70" fill="#fde7c8"/>
  ${eye(-1)}${eye(1)}
  <ellipse cx="${cx}" cy="${cy + 46}" rx="20" ry="14" fill="#e0707a"/>
  ${mouthSvg(m, cx, cy + 84)}`
}

const bustSvg = (fur: string, eyes: Parameters<typeof headSvg>[1], m: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${headSvg(fur, eyes, m)}<ellipse cx="512" cy="1030" rx="330" ry="190" fill="${fur}"/><path d="M 330 880 Q 512 950 694 880 L 706 940 Q 512 1010 318 940 Z" fill="#3aa860"/></svg>`

function bodySvg(fur: string, pose: 'stand' | 'walk-a' | 'walk-b' | 'crouch' | 'air') {
  const squash = pose === 'crouch' ? 0.62 : 1
  const legs = pose === 'walk-a' ? [-70, 70] : pose === 'walk-b' ? [70, -70] : pose === 'air' ? [-120, 120] : [0, 0]
  const arms = pose === 'air' ? `<rect x="130" y="470" width="90" height="230" rx="45" transform="rotate(-35 175 590)" fill="${fur}"/><rect x="804" y="470" width="90" height="230" rx="45" transform="rotate(35 849 590)" fill="${fur}"/>` : ''
  const ground = pose === 'air' ? 880 : 960
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><g transform="translate(0 ${(1 - squash) * 700}) scale(1 ${squash})">
    <path d="M 740 780 Q 920 720 880 560 Q 860 520 830 560 Q 850 650 730 700" fill="${fur}"/>
    <ellipse cx="512" cy="700" rx="230" ry="260" fill="${fur}"/><ellipse cx="512" cy="740" rx="130" ry="190" fill="#fde7c8"/>
    ${arms}
    <rect x="${340 + legs[0]}" y="${ground - 80}" width="130" height="80" rx="40" fill="${fur}"/><rect x="${554 + legs[1]}" y="${ground - 80}" width="130" height="80" rx="40" fill="${fur}"/>
    <path d="M 320 520 Q 512 600 704 520 L 716 600 Q 512 690 308 600 Z" fill="#3aa860"/>
    <g transform="translate(0 -30) scale(0.78) translate(112 90)">${headSvg(fur, 'open', 0)}</g></g></svg>`
}

/** Placeholder kit with deterministic colours per character, written as real PNGs with the same roles as a real kit. */
export async function buildMockKit(name: string, outDir: string): Promise<CharacterKit> {
  fs.mkdirSync(outDir, { recursive: true })
  const n = safeName(name)
  const fur = `hsl(${parseInt(hashOf(name).slice(0, 4), 16) % 60 + 10},85%,55%)`
  const write = async (file: string, svg: string) => { await sharp(Buffer.from(svg)).png().toFile(path.join(outDir, file)); return file }
  const [stand, wa, wb, crouch, air] = await Promise.all((['stand', 'walk-a', 'walk-b', 'crouch', 'air'] as const).map((p) => write(`${n}-body-${p}.png`, bodySvg(fur, p))))
  const face = await Promise.all([0, 1, 2, 3].map((m) => write(`${n}-face-${m}.png`, bustSvg(fur, 'open', m)))) as CharacterKit['face']
  const blink = await write(`${n}-face-blink.png`, `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">${[-1, 1].map((d) => `<path d="M ${512 + d * 100 - 36} 456 Q ${512 + d * 100} 476 ${512 + d * 100 + 36} 456" stroke="#2a1608" stroke-width="10" fill="none" stroke-linecap="round"/>`).join('')}</svg>`)
  const emotions: Record<string, string> = {}
  for (const [e, eyes] of [['happy', 'closed'], ['surprised', 'wide'], ['smug', 'half']] as const) emotions[e] = await write(`${n}-bust-${e}.png`, bustSvg(fur, eyes, 0))
  return { name, stand, walk: [wa, wb], crouch, air, face, blink, emotions }
}

/**
 * The INPUTS of a kit (full images, as the image service would return them) drawn as placeholders. Lets the real assembly
 * (`buildKit`) be run and tested with no generation cost.
 */
export async function buildMockSources(name: string, dir: string): Promise<KitSources> {
  fs.mkdirSync(dir, { recursive: true })
  const fur = `hsl(${parseInt(hashOf(name).slice(0, 4), 16) % 60 + 10},85%,55%)`
  const w = async (file: string, svg: string) => { const f = path.join(dir, file); await sharp(Buffer.from(svg)).png().toFile(f); return f }
  return {
    stand: await w('src-stand.png', bodySvg(fur, 'stand')), walkA: await w('src-walk-a.png', bodySvg(fur, 'walk-a')), walkB: await w('src-walk-b.png', bodySvg(fur, 'walk-b')),
    crouch: await w('src-crouch.png', bodySvg(fur, 'crouch')), air: await w('src-air.png', bodySvg(fur, 'air')),
    closed: await w('src-closed.png', bustSvg(fur, 'open', 0)), happy: await w('src-happy.png', bustSvg(fur, 'closed', 0)),
    surprised: await w('src-surprised.png', bustSvg(fur, 'wide', 0)), smug: await w('src-smug.png', bustSvg(fur, 'half', 0)),
    slightlyOpen: await w('src-m1.png', bustSvg(fur, 'open', 1)), roundOh: await w('src-m2.png', bustSvg(fur, 'open', 2)), wideOpen: await w('src-m3.png', bustSvg(fur, 'open', 3)),
    blink: await w('src-blink.png', bustSvg(fur, 'closed', 0)),
  }
}

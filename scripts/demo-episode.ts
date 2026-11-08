/* Free end-to-end test of the Animation Engine: placeholder art (SVG), macOS voices, audio-driven lip-sync, Remotion render.
 * Run:  pnpm tsx scripts/demo-episode.ts            (outputs to render/demo/)
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { mouthFrames, mouthTrackFromFile } from '../src/engine/lipsync'
import { normalizeLoudness } from '../src/engine/finish'
import { renderTimeline } from '../src/engine/render'
import type { TimelineInput } from '../src/engine/timeline'

const W = 720, H = 1280
const root = path.resolve('render/demo')
const assets = path.join(root, 'assets')
fs.mkdirSync(assets, { recursive: true })

// ---------- placeholder art ----------
const mouth = (m: number, cx: number, cy: number, s: number) => [
  `<path d="M ${cx - 40 * s} ${cy} Q ${cx} ${cy + 18 * s} ${cx + 40 * s} ${cy}" stroke="#5a2a14" stroke-width="${6 * s}" fill="none" stroke-linecap="round"/>`,
  `<ellipse cx="${cx}" cy="${cy + 8 * s}" rx="${24 * s}" ry="${12 * s}" fill="#5a1d1d"/>`,
  `<ellipse cx="${cx}" cy="${cy + 14 * s}" rx="${34 * s}" ry="${26 * s}" fill="#5a1d1d"/><ellipse cx="${cx}" cy="${cy + 26 * s}" rx="${20 * s}" ry="${10 * s}" fill="#e0707a"/>`,
  `<ellipse cx="${cx}" cy="${cy + 20 * s}" rx="${46 * s}" ry="${38 * s}" fill="#5a1d1d"/><ellipse cx="${cx}" cy="${cy + 38 * s}" rx="${28 * s}" ry="${14 * s}" fill="#e0707a"/>`,
][m]

const eyes = (kind: 'neutral' | 'happy' | 'surprised' | 'angry', cx: number, cy: number, s: number) => {
  const dx = 70 * s
  if (kind === 'happy') return [-1, 1].map((d) => `<path d="M ${cx + d * dx - 28 * s} ${cy + 6 * s} Q ${cx + d * dx} ${cy - 26 * s} ${cx + d * dx + 28 * s} ${cy + 6 * s}" stroke="#2a1608" stroke-width="${9 * s}" fill="none" stroke-linecap="round"/>`).join('')
  const r = kind === 'surprised' ? 34 * s : 24 * s
  const lids = kind === 'angry' ? [-1, 1].map((d) => `<path d="M ${cx + d * dx - 36 * s} ${cy - 34 * s * d * -1 - 14 * s} L ${cx + d * dx + 36 * s} ${cy - 34 * s * d - 14 * s}" stroke="#2a1608" stroke-width="${9 * s}" stroke-linecap="round"/>`).join('') : ''
  return [-1, 1].map((d) => `<ellipse cx="${cx + d * dx}" cy="${cy}" rx="${r}" ry="${r * 1.15}" fill="#fff"/><circle cx="${cx + d * dx}" cy="${cy + 3 * s}" r="${r * 0.55}" fill="#2a1608"/><circle cx="${cx + d * dx + 6 * s}" cy="${cy - 4 * s}" r="${r * 0.2}" fill="#fff"/>`).join('') + lids
}

function head(opts: { eye: Parameters<typeof eyes>[0]; m: number; cx: number; cy: number; s: number }) {
  const { cx, cy, s } = opts
  return `
  <polygon points="${cx - 150 * s},${cy - 70 * s} ${cx - 120 * s},${cy - 190 * s} ${cx - 40 * s},${cy - 120 * s}" fill="#f08a2c"/>
  <polygon points="${cx + 150 * s},${cy - 70 * s} ${cx + 120 * s},${cy - 190 * s} ${cx + 40 * s},${cy - 120 * s}" fill="#f08a2c"/>
  <polygon points="${cx - 128 * s},${cy - 90 * s} ${cx - 116 * s},${cy - 160 * s} ${cx - 70 * s},${cy - 120 * s}" fill="#f7b3a0"/>
  <polygon points="${cx + 128 * s},${cy - 90 * s} ${cx + 116 * s},${cy - 160 * s} ${cx + 70 * s},${cy - 120 * s}" fill="#f7b3a0"/>
  <ellipse cx="${cx}" cy="${cy}" rx="${170 * s}" ry="${150 * s}" fill="#f6962e"/>
  <path d="M ${cx - 20 * s} ${cy - 150 * s} L ${cx} ${cy - 90 * s} L ${cx + 20 * s} ${cy - 150 * s}" fill="#d9701a"/>
  <ellipse cx="${cx}" cy="${cy + 60 * s}" rx="${70 * s}" ry="${50 * s}" fill="#fde7c8"/>
  ${eyes(opts.eye, cx, cy - 10 * s, s)}
  <ellipse cx="${cx}" cy="${cy + 32 * s}" rx="${14 * s}" ry="${10 * s}" fill="#e0707a"/>
  ${mouth(opts.m, cx, cy + 58 * s, s)}
  <g stroke="#7a4a1e" stroke-width="${3 * s}">${[-1, 1].map((d) => [0, 1, 2].map((i) => `<line x1="${cx + d * 60 * s}" y1="${cy + (44 + i * 10) * s}" x2="${cx + d * 150 * s}" y2="${cy + (24 + i * 22) * s}"/>`).join('')).join('')}</g>`
}

const close = (eye: Parameters<typeof eyes>[0], m: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">${head({ eye, m, cx: 400, cy: 360, s: 1.4 })}<ellipse cx="400" cy="800" rx="260" ry="130" fill="#f08a2c"/><path d="M 250 700 Q 400 770 550 700 L 560 760 Q 400 830 240 760 Z" fill="#3aa860"/></svg>`
const full = (m: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="1000" viewBox="0 0 700 1000">
  <path d="M 560 760 Q 700 700 660 560 Q 640 520 610 560 Q 630 650 540 700" fill="#f08a2c" stroke="#d9701a" stroke-width="6"/>
  <ellipse cx="350" cy="720" rx="190" ry="230" fill="#f08a2c"/><ellipse cx="350" cy="760" rx="110" ry="170" fill="#fde7c8"/>
  <rect x="200" y="900" width="110" height="70" rx="34" fill="#f08a2c"/><rect x="390" y="900" width="110" height="70" rx="34" fill="#f08a2c"/>
  <path d="M 230 520 Q 350 590 470 520 L 480 590 Q 350 660 220 590 Z" fill="#3aa860"/>
  ${head({ eye: 'neutral', m, cx: 350, cy: 380, s: 1.2 })}</svg>`
const scene = (top: string, bottom: string, deco: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>${deco}</svg>`

const png = (name: string, svg: string, w?: number) => sharp(Buffer.from(svg)).resize(w ? { width: w } : undefined).png().toFile(path.join(assets, name))

async function art() {
  await Promise.all([
    png('bg-kitchen.png', scene('#ffd9a8', '#c98a5a', `<rect x="60" y="260" width="600" height="140" rx="20" fill="#8a5a3a" opacity=".5"/><circle cx="560" cy="160" r="80" fill="#fff3c4" opacity=".8"/><rect y="880" width="${W}" height="400" fill="#a86f45"/><rect x="40" y="820" width="640" height="70" rx="12" fill="#7a4a2a"/>`)),
    png('bg-sky.png', scene('#7ec8ff', '#d9f2ff', `<ellipse cx="160" cy="260" rx="120" ry="50" fill="#fff" opacity=".9"/><ellipse cx="540" cy="420" rx="150" ry="56" fill="#fff" opacity=".9"/><rect y="1000" width="${W}" height="280" fill="#6cc17a"/>`)),
    png('bg-night.png', scene('#241a4a', '#6a3b8a', `<circle cx="540" cy="220" r="90" fill="#fff6c8"/><rect y="1010" width="${W}" height="270" fill="#2a1f3a"/>`)),
    png('cat-stand.png', full(0), 560),
    ...(['neutral', 'happy', 'surprised', 'angry'] as const).map((e) => png(`cat-${e}.png`, close(e, 0), 700)),
    ...[0, 1, 2, 3].map((m) => png(`cat-mouth${m}.png`, close('neutral', m), 700)),
  ])
}

// ---------- audio ----------
function voice(name: string, text: string, v: string) {
  const aiff = path.join(assets, `${name}.aiff`)
  try { execFileSync('say', ['-v', v, '-o', aiff, text]) } catch { execFileSync('say', ['-o', aiff, text]) }
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', aiff, '-ar', '44100', '-ac', '1', path.join(assets, `${name}.wav`)])
  fs.unlinkSync(aiff)
  return `${name}.wav`
}
const duration = (file: string) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(assets, file)]).toString().trim())

async function main() {
  const t0 = Date.now()
  await art()
  const l1 = voice('line1', 'Trust me. This plan is going to work perfectly.', 'Samantha')
  const l2 = voice('line2', 'Oh no. Oh no no no. It is not working!', 'Fred')
  const d1 = duration(l1), d2 = duration(l2)
  // placeholder music: a soft chord loop
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=262:duration=10', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=10', '-f', 'lavfi', '-i', 'sine=frequency=392:duration=10', '-filter_complex', '[0][1][2]amix=inputs=3,tremolo=f=2:d=0.4,volume=0.6', path.join(assets, 'music.wav')])

  const fps = 30
  const m1 = await mouthTrackFromFile(path.join(assets, l1), fps)
  const m2 = await mouthTrackFromFile(path.join(assets, l2), fps)
  const mouths: [string, string, string, string] = ['cat-mouth0.png', 'cat-mouth1.png', 'cat-mouth2.png', 'cat-mouth3.png']

  // shot lengths come from the audio so lips and shots line up
  const s2 = Math.max(2.4, d1 + 0.5), s4 = Math.max(2.4, d2 + 0.5)
  const timeline: TimelineInput = {
    fps, width: W, height: H,
    look: { grade: 'warm', grain: 0.25, vignette: 0.4 },
    shots: [
      { id: 's1', durationSec: 2.6, background: 'bg-kitchen.png', camera: { move: 'push-in', intensity: 0.7, handheld: 0.3 }, layers: [
        { kind: 'particles', preset: 'dust', count: 16 },
        { kind: 'character', id: 'cat', x: 0.5, y: 0.98, width: 0.62, frames: [{ atSec: 0, src: 'cat-stand.png' }], enter: 'pop', motion: 'breathe' },
        { kind: 'text', text: "Chef Mango's master plan", atSec: 0.3, durationSec: 2, position: 'top' },
      ] },
      { id: 's2', durationSec: s2, background: 'bg-kitchen.png', transitionIn: 'whip', camera: { move: 'push-in', intensity: 0.5, handheld: 0.35 }, layers: [
        { kind: 'character', id: 'cat', x: 0.5, y: 0.8, width: 1.0, frames: mouthFrames(m1, { startSec: 0.1, endSec: 0.1 + d1, mouthSrc: mouths, restSrc: 'cat-happy.png' }), motion: 'breathe' },
      ] },
      { id: 's3', durationSec: 2.2, background: 'bg-sky.png', transitionIn: 'whip', camera: { move: 'shake', intensity: 0.9, handheld: 0.3 }, layers: [
        { kind: 'particles', preset: 'sparkles', count: 14 },
        { kind: 'character', id: 'cat', x: 0.5, y: 0.8, width: 0.6, frames: [{ atSec: 0, src: 'cat-stand.png' }], motion: 'bob', enter: 'slide-right' },
        { kind: 'text', text: 'WHOOOOSH!', atSec: 0.2, durationSec: 1.6, position: 'top' },
      ] },
      { id: 's4', durationSec: s4, background: 'bg-night.png', transitionIn: 'fade', camera: { move: 'push-in', intensity: 0.8, handheld: 0.4 }, layers: [
        { kind: 'character', id: 'cat', x: 0.5, y: 0.8, width: 1.0, frames: [...mouthFrames(m2, { startSec: 0.2, endSec: 0.2 + d2, mouthSrc: mouths, restSrc: 'cat-surprised.png' })], motion: 'breathe' },
      ] },
      { id: 's5', durationSec: 2.2, background: 'bg-night.png', transitionIn: 'cut', camera: { move: 'pull-out', intensity: 0.6, handheld: 0.2 }, layers: [
        { kind: 'particles', preset: 'dust', count: 12 },
        { kind: 'character', id: 'cat', x: 0.5, y: 0.98, width: 0.6, frames: [{ atSec: 0, src: 'cat-stand.png' }], motion: 'breathe' },
        { kind: 'text', text: 'Tomorrow: Plan B', atSec: 0.2, durationSec: 1.8, position: 'top' },
      ] },
    ],
    voices: [{ src: l1, startSec: 2.6 + 0.1 }, { src: l2, startSec: 2.6 + s2 + 2.2 + 0.2 }],
    captions: [
      { text: 'Trust me. This plan is going to work perfectly.', startSec: 2.7, endSec: 2.7 + d1 },
      { text: 'Oh no. Oh no no no. It is not working!', startSec: 2.6 + s2 + 2.2 + 0.2, endSec: 2.6 + s2 + 2.2 + 0.2 + d2 },
    ],
    music: { src: 'music.wav', volume: 0.18 },
  }

  const chrome = fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : null
  console.log(`art + audio ready in ${((Date.now() - t0) / 1000).toFixed(1)}s; lip-sync keys: ${m1.length} + ${m2.length}; rendering with ${chrome ? 'installed Chrome' : "Remotion's browser"}...`)
  let last = -1
  const info = await renderTimeline({
    timeline, assetsDir: assets, outFile: path.join(root, 'out.mp4'), browserExecutable: chrome,
    onProgress: (p) => { const pct = Math.floor(p.progress * 10) * 10; if (pct !== last) { last = pct; console.log(`  render ${pct}% (${p.renderedFrames}/${p.totalFrames})`) } },
  })
  const loud = await normalizeLoudness(path.join(root, 'out.mp4'))
  console.log('loudness', loud)
  console.log('done', info, `in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

main().catch((e) => { console.error(e); process.exit(1) })

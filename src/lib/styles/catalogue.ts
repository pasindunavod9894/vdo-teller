import type { CaptionStyle, Transition } from '../../engine/timeline'
import { DEFAULT_VIDEO_MODEL, type VideoModelId } from '../video'

/**
 * The master style catalogue (plan R1-A). Each style is a complete recipe, not just a sentence: how images look, what to avoid,
 * how things move, the colour grade, the caption look and which transitions suit it. Image prompts describe the LOOK only and never
 * name a studio or brand (monetization guardrails). The Style agent turns one of these into a series-specific style bible.
 */
export type GradePreset = { saturation: number; contrast: number; /** -0.1 (cool) .. 0.1 (warm) */ warmth: number; brightness?: number }

export type StyleSpec = {
  id: string
  name: string
  /** one line shown on the wizard card */
  look: string
  /** the medium, rendering, shading, texture, lighting and lens */
  imagePrompt: string
  /** what must not appear in images and clips of this style */
  negativePrompt: string
  /** how things move; added to every video prompt */
  motionLanguage: string
  videoModel: VideoModelId
  grade: GradePreset & { grain: number; vignette: number }
  /** the default caption look (font names are Google Fonts; a missing font falls back to the system one) */
  caption: Partial<CaptionStyle>
  /** the xfade transitions that suit it */
  transitions: Exclude<Transition, 'cut'>[]
  /** five default colours, used until the Style agent picks a series palette */
  palette: [string, string, string, string, string]
}

const M = DEFAULT_VIDEO_MODEL
const CARTOON_NEG = 'photorealistic skin, live-action, 3D render artefacts, text, watermark, logo'

export const STYLE_CATALOGUE: StyleSpec[] = [
  {
    id: 'disney-classic', name: 'Disney-style classic cartoon', look: 'Hand-drawn feature-animation look, expressive faces',
    imagePrompt: 'classic hand-drawn feature-animation look, painted soft shading, clean ink lines, expressive faces, richly painted backgrounds, warm storybook colours, soft golden lighting',
    negativePrompt: `${CARTOON_NEG}, harsh digital sharpening`,
    motionLanguage: 'fluid hand-drawn motion with gentle squash and stretch, anticipation before a move, held expressive poses, soft camera glides',
    videoModel: M, grade: { saturation: 1.12, contrast: 1.04, warmth: 0.03, grain: 0.04, vignette: 0.2 },
    caption: { font: 'Baloo 2', primary: '#FFFFFF', highlight: '#FFD84D', bold: true }, transitions: ['fade', 'smoothleft', 'dissolve'],
    palette: ['#F4C95D', '#E4572E', '#76B041', '#2E86AB', '#5B3A29'],
  },
  {
    id: 'pixar-3d', name: '3D Pixar-like', look: 'Soft 3D render, big eyes, warm light',
    imagePrompt: 'soft 3D animated-film render, big expressive eyes, subsurface fur or skin detail, rounded appealing shapes, warm cinematic lighting, shallow depth of field, painterly environments',
    negativePrompt: 'flat 2D, hand-drawn lines, photoreal skin pores, text, watermark, logo, uncanny faces',
    motionLanguage: 'smooth, weighty 3D character animation with believable physics, expressive faces, gentle cinematic camera moves',
    videoModel: M, grade: { saturation: 1.1, contrast: 1.06, warmth: 0.02, grain: 0.03, vignette: 0.25 },
    caption: { font: 'Fredoka', primary: '#FFFFFF', highlight: '#FFB938', bold: true }, transitions: ['fade', 'smoothleft', 'zoomin'],
    palette: ['#FFB938', '#FF6B6B', '#4ECDC4', '#2D6A8F', '#3B2A20'],
  },
  {
    id: 'anime', name: 'Anime', look: 'Speed lines, dramatic lighting',
    imagePrompt: 'Japanese anime style, clean line art, cel shading, large expressive eyes, dramatic rim lighting, vivid sky and detailed backgrounds',
    negativePrompt: 'photorealistic, 3D render, western cartoon proportions, text, watermark, logo',
    motionLanguage: 'limited animation with held frames then fast bursts of motion, dramatic camera pushes, speed lines on action, wind in hair and clothes',
    videoModel: M, grade: { saturation: 1.2, contrast: 1.1, warmth: 0, grain: 0.02, vignette: 0.15 },
    caption: { font: 'Rubik', primary: '#FFFFFF', highlight: '#FF4D8D', bold: true, uppercase: true }, transitions: ['slideleft', 'zoomin', 'wiperight'],
    palette: ['#FF4D8D', '#4D9DE0', '#FFD23F', '#1B1F3B', '#EEF0F2'],
  },
  {
    id: 'cartoon-2d', name: 'Modern 2D cartoon', look: 'Bold outlines, flat colours',
    imagePrompt: 'modern 2D cartoon, bold clean outlines, flat bright colours, simple shapes, playful proportions, minimal shading',
    negativePrompt: `${CARTOON_NEG}, gradients that look 3D`,
    motionLanguage: 'snappy cartoon motion with exaggerated squash and stretch, quick comedic timing, bouncy overshoots',
    videoModel: M, grade: { saturation: 1.25, contrast: 1.05, warmth: 0, grain: 0, vignette: 0.1 },
    caption: { font: 'Fredoka', primary: '#FFFFFF', highlight: '#FFE14D', bold: true }, transitions: ['slideleft', 'smoothleft', 'circleopen'],
    palette: ['#FF6B6B', '#FFE14D', '#4ECDC4', '#5567FF', '#2B2D42'],
  },
  {
    id: 'realistic', name: 'Realistic / cinematic', look: 'Photoreal, film-like',
    imagePrompt: 'photorealistic, natural fur or skin detail, cinematic soft lighting, shallow depth of field, 35mm film look',
    negativePrompt: 'cartoon, illustration, plastic skin, extra limbs, uncanny faces, text, watermark, logo',
    motionLanguage: 'natural, believable real-world motion and physics, gentle handheld or slow dolly camera, no exaggeration',
    videoModel: M, grade: { saturation: 0.95, contrast: 1.1, warmth: 0.02, grain: 0.25, vignette: 0.35 },
    caption: { font: 'Montserrat', primary: '#FFFFFF', highlight: '#FFD166', bold: true }, transitions: ['fade', 'dissolve', 'fadeblack'],
    palette: ['#D9A441', '#8C5A3C', '#3F5E5A', '#1F2A37', '#F2E8DC'],
  },
  {
    id: 'storybook', name: 'Storybook / watercolour', look: 'Illustrated picture book',
    imagePrompt: 'watercolour picture-book illustration, soft textured paper feel, gentle colours, loose ink outlines, dreamy light',
    negativePrompt: 'photorealistic, 3D render, harsh outlines, neon colours, text, watermark, logo',
    motionLanguage: 'slow, gentle movement as if the page comes alive, soft drifting camera, small natural motions like breathing and swaying',
    videoModel: M, grade: { saturation: 0.9, contrast: 0.96, warmth: 0.02, brightness: 0.02, grain: 0.1, vignette: 0.15 },
    caption: { font: 'Lora', primary: '#FFFDF5', highlight: '#F4A261', bold: false }, transitions: ['fade', 'dissolve', 'smoothright'],
    palette: ['#F4A261', '#E9C46A', '#8AB17D', '#6B9AC4', '#5C4B51'],
  },
  {
    id: 'claymation', name: 'Claymation', look: 'Clay or felt figures, stop-motion feel',
    imagePrompt: 'claymation stop-motion figure, visible clay texture and fingerprints, handmade felt props, miniature set, warm tabletop lighting',
    negativePrompt: 'smooth digital render, 2D drawing, photoreal skin, text, watermark, logo',
    motionLanguage: 'stop-motion feel at a low frame rate, small jerky handmade movements, characters shift between poses, tabletop camera',
    videoModel: M, grade: { saturation: 1.05, contrast: 1.04, warmth: 0.02, grain: 0.08, vignette: 0.2 },
    caption: { font: 'Fredoka', primary: '#FFFFFF', highlight: '#FF9F1C', bold: true }, transitions: ['fade', 'slideleft', 'pixelize'],
    palette: ['#FF9F1C', '#E71D36', '#2EC4B6', '#7B6D8D', '#3D2C2E'],
  },
  {
    id: 'comic', name: 'Comic / motion comic', look: 'Panels and halftone',
    imagePrompt: 'comic-book illustration, inked outlines, halftone shading, bold colours, dramatic angles, speech-bubble-free panels',
    negativePrompt: 'photorealistic, soft watercolour, 3D render, speech bubbles with text, watermark, logo',
    motionLanguage: 'motion-comic feel: punchy camera pushes, impact moments, held dramatic poses, quick snaps between angles',
    videoModel: M, grade: { saturation: 1.3, contrast: 1.2, warmth: 0, grain: 0.05, vignette: 0.1 },
    caption: { font: 'Bangers', primary: '#FFFFFF', highlight: '#FFE14D', bold: false, uppercase: true }, transitions: ['wipeleft', 'slideleft', 'zoomin'],
    palette: ['#E63946', '#F1FAEE', '#457B9D', '#FFB703', '#1D3557'],
  },
  {
    id: 'documentary', name: 'Documentary', look: 'Photoreal stills with a slow camera',
    imagePrompt: 'photorealistic documentary photography, natural light, true colour, archival feel, grounded composition',
    negativePrompt: 'cartoon, illustration, oversaturated colours, fantasy elements, text, watermark, logo',
    motionLanguage: 'slow, observational camera: gentle push-ins and drifts, natural movement, no dramatic effects',
    videoModel: M, grade: { saturation: 0.85, contrast: 1.08, warmth: -0.01, grain: 0.2, vignette: 0.3 },
    caption: { font: 'Montserrat', primary: '#FFFFFF', highlight: '#7FC8F8', bold: true }, transitions: ['fade', 'dissolve', 'fadeblack'],
    palette: ['#A68A64', '#5C6B73', '#253237', '#9DB4C0', '#E0FBFC'],
  },
  {
    id: 'explainer', name: 'Animated explainer', look: 'Icons, charts and characters',
    imagePrompt: 'clean flat vector illustration, friendly rounded shapes, limited palette, simple icons and charts, generous white space',
    negativePrompt: 'photorealistic, heavy textures, 3D render, cluttered backgrounds, watermark, logo',
    motionLanguage: 'clean, purposeful motion: elements slide and pop in, smooth easing, steady framing',
    videoModel: M, grade: { saturation: 1.1, contrast: 1.02, warmth: 0, grain: 0, vignette: 0.05 },
    caption: { font: 'Poppins', primary: '#FFFFFF', highlight: '#00C2A8', bold: true }, transitions: ['slideleft', 'smoothleft', 'wiperight'],
    palette: ['#00C2A8', '#FFB400', '#5B5BD6', '#102542', '#F5F7FA'],
  },
  {
    id: 'kinetic', name: 'Kinetic typography', look: 'Animated text-led visuals',
    imagePrompt: 'bold flat graphic design, simple vector shapes, strong colour blocking, large clean shapes with room for text',
    negativePrompt: 'photorealistic, busy scenes, small details, watermark, logo',
    motionLanguage: 'rhythmic, beat-driven motion: shapes and camera snap and slide in time, strong easing, bold scale changes',
    videoModel: M, grade: { saturation: 1.15, contrast: 1.15, warmth: 0, grain: 0, vignette: 0.1 },
    caption: { font: 'Archivo Black', primary: '#FFFFFF', highlight: '#FF3366', bold: false, uppercase: true, size: 0.07 }, transitions: ['slideleft', 'zoomin', 'wipeleft'],
    palette: ['#FF3366', '#FFD60A', '#00B4D8', '#14213D', '#FFFFFF'],
  },
]

export const STYLE_IDS = STYLE_CATALOGUE.map((s) => s.id) as [string, ...string[]]

export const FALLBACK_STYLE = 'cartoon-2d'
export const styleSpec = (id: string): StyleSpec => STYLE_CATALOGUE.find((s) => s.id === id) ?? STYLE_CATALOGUE.find((s) => s.id === FALLBACK_STYLE)!

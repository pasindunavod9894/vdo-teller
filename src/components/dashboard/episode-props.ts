import { videoCostUsd, isVideoModel, DEFAULT_VIDEO_MODEL, type VideoModelId } from '@/lib/video'
import { fixShotEstimateUsd } from '@/pipeline/fix-shot'
import type { QaData, QaFlag, ReviewData, ReviewIdea } from './episode-types'

// Server only (fix-shot imports Node modules): turns an episode's saved JSON into plain props for the client components.

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const modelOf = (m: unknown): VideoModelId => (isVideoModel(m) ? m : DEFAULT_VIDEO_MODEL)

function ideaOf(v: unknown): ReviewIdea | null {
  const o = obj(v)
  if (!o) return null
  return { title: str(o.title), premise: str(o.premise), hook: str(o.hook), emotionalCore: str(o.emotionalCore) }
}

/** What the review card shows for an episode that waits for approval. */
export function reviewDataOf(e: { title?: string | null; idea?: unknown; ideas?: unknown; script?: unknown; shots?: unknown; costUsd?: number | null }, videoModel: unknown): ReviewData {
  const model = modelOf(videoModel)
  const idea = ideaOf(e.idea)
  const beats = (Array.isArray(obj(e.script)?.beats) ? (obj(e.script)!.beats as unknown[]) : []).flatMap((b) => {
    const o = obj(b)
    return o ? [{ n: num(o.n), action: str(o.action), speaker: str(o.speaker) || null, line: str(o.line) || null }] : []
  })
  const shotList = (Array.isArray(obj(e.shots)?.shots) ? (obj(e.shots)!.shots as unknown[]) : []).flatMap((s) => {
    const o = obj(s)
    return o ? [{ n: num(o.n), caption: str(o.angle) || str(o.type), seconds: num(o.videoSeconds, 5) }] : []
  })
  const others = (Array.isArray(e.ideas) ? e.ideas : []).flatMap((i) => {
    const x = ideaOf(i)
    return x && x.title && x.title !== idea?.title ? [{ title: x.title, premise: x.premise }] : []
  })
  const estimate = shotList.reduce((sum, s) => sum + videoCostUsd(model, s.seconds), 0)
  return {
    title: e.title || idea?.title || '',
    idea, otherIdeas: others, beats,
    shots: shotList.map(({ n, caption }) => ({ n, caption })),
    costUsd: e.costUsd ?? 0,
    videoEstimateUsd: Math.round(estimate * 100) / 100,
  }
}

/** The flagged shots of a finished episode, the remake in progress, and what remaking each shot costs. */
export function qaDataOf(e: { qaFlags?: unknown; files?: unknown; script?: unknown; shots?: unknown }, videoModel: unknown): QaData {
  const flags: QaFlag[] = (Array.isArray(e.qaFlags) ? e.qaFlags : []).flatMap((f) => {
    const o = obj(f)
    return o && typeof o.shot === 'number' ? [{ shot: o.shot, kind: (str(o.kind) || 'other') as QaFlag['kind'], issue: str(o.issue) }] : []
  })
  const files = obj(e.files)
  const fx = obj(files?.fixing)
  const fixing = fx && typeof fx.shot === 'number' ? { shot: fx.shot, at: str(fx.at) } : null
  const fixError = str(files?.fixError) || null

  const model = modelOf(videoModel)
  const beats = new Map((Array.isArray(obj(e.script)?.beats) ? (obj(e.script)!.beats as unknown[]) : []).flatMap((b) => { const o = obj(b); return o ? [[num(o.n), o] as const] : [] }))
  const shots = new Map((Array.isArray(obj(e.shots)?.shots) ? (obj(e.shots)!.shots as unknown[]) : []).flatMap((s) => { const o = obj(s); return o ? [[num(o.n), o] as const] : [] }))
  const estimates: Record<number, number> = {}
  for (const n of new Set([...flags.map((f) => f.shot), ...(fixing ? [fixing.shot] : [])])) {
    const shot = shots.get(n)
    const beat = shot ? beats.get(num(shot.beat)) : undefined
    const speaker = str(beat?.speaker)
    const hasLine = Boolean(str(beat?.line)) && Boolean(speaker) && speaker.toLowerCase() !== 'narrator'
    estimates[n] = fixShotEstimateUsd(model, num(shot?.videoSeconds, 5), hasLine)
  }
  return { flags, fixing, fixError, estimates }
}

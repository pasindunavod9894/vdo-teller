import type { Resume } from './orchestrator'
import type { Idea, Script } from './schemas'

const MAX_AGE_MS = 24 * 3600_000

export type PastEpisode = { status: string; createdAt: string | Date; idea?: unknown; script?: unknown; critique?: unknown }

const isIdea = (v: unknown): v is Idea => !!v && typeof v === 'object' && typeof (v as Idea).title === 'string' && typeof (v as Idea).premise === 'string'
const isScript = (v: unknown): v is Script => !!v && typeof v === 'object' && Array.isArray((v as Script).beats) && (v as Script).beats.length > 0
const approved = (v: unknown) => !!v && typeof v === 'object' && (v as { approved?: unknown }).approved === true

/**
 * If the newest attempt for a series failed AFTER its script was approved (for example in the render), the next attempt
 * reuses that idea and script (plan §3b: a retry reuses finished steps). `past` is newest first. Once an episode has
 * finished (or needs review), older failures are no longer relevant. Attempts older than 24 h are not reused.
 */
export function pickResume(past: PastEpisode[], now = new Date()): Resume | null {
  for (const e of past) {
    if (e.status === 'done' || e.status === 'needs-review' || e.status === 'running') return null
    if (e.status !== 'failed') continue
    if (now.getTime() - new Date(e.createdAt).getTime() > MAX_AGE_MS) return null
    if (isIdea(e.idea) && isScript(e.script) && approved(e.critique)) return { idea: e.idea, script: e.script }
    return null // the newest failure had nothing worth reusing
  }
  return null
}

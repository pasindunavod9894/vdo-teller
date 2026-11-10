import { scrubDeep } from './brand-safety'
import { isVibe, type VibeId } from '../lib/vibes'
import type { Idea, Script } from './schemas'

/**
 * What a series remembers from its earlier reels (plan R3): the recent ideas and running gags, so the next idea is new, and the recurring
 * supporting characters, so a character the story invented can come back with the same look. Updated in code when a reel is finished (no model
 * call). It goes into the episode block of the prompts, not the cached prefix, because it changes every episode.
 */
export type RecurringCharacter = { name: string; role: string; canonicalLook: string; personality: string; voice: string | null }
export type SeriesMemory = { recent: { title: string; premise: string; runningGag: string | null; /** the vibe of that reel, so the next one feels different */ vibe?: VibeId | null }[]; recurringCast: RecurringCharacter[] }

export const MEMORY_RECENT = 8
export const MEMORY_RECURRING = 6

export const emptyMemory = (): SeriesMemory => ({ recent: [], recurringCast: [] })

const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

/** Reads the stored json (from the database) tolerantly: anything malformed becomes an empty memory rather than an error. */
export function readMemory(raw: unknown): SeriesMemory {
  if (!raw || typeof raw !== 'object') return emptyMemory()
  const r = raw as Partial<SeriesMemory>
  const recent = (Array.isArray(r.recent) ? r.recent : []).map((e) => ({ title: str(e?.title, 120), premise: str(e?.premise), runningGag: e?.runningGag ? str(e.runningGag, 160) : null, vibe: isVibe(e?.vibe) ? e.vibe : null })).filter((e) => e.title).slice(0, MEMORY_RECENT)
  const recurringCast = (Array.isArray(r.recurringCast) ? r.recurringCast : [])
    .map((c) => ({ name: str(c?.name, 40), role: str(c?.role, 80), canonicalLook: str(c?.canonicalLook, 400), personality: str(c?.personality, 120), voice: c?.voice ? str(c.voice, 30) : null }))
    .filter((c) => c.name && c.canonicalLook).slice(0, MEMORY_RECURRING)
  return { recent, recurringCast }
}

/** Remembers a finished reel: its idea goes to the front of the recent list, and each supporting character marked `recurring` is saved or updated. */
export function rememberEpisode(memory: SeriesMemory, ep: { idea: Idea; script: Script }): SeriesMemory {
  const clean = scrubDeep(ep)
  const entry = { title: str(clean.idea.title, 120), premise: str(clean.idea.premise), runningGag: clean.idea.runningGag ? str(clean.idea.runningGag, 160) : null, vibe: isVibe(clean.idea.vibe) ? clean.idea.vibe : null }
  const recent = [entry, ...memory.recent.filter((e) => e.title.toLowerCase() !== entry.title.toLowerCase())].slice(0, MEMORY_RECENT)
  const cast = new Map(memory.recurringCast.map((c) => [c.name.toLowerCase(), c]))
  for (const s of clean.script.supportingCast) {
    if (!s.recurring) continue
    cast.set(s.name.toLowerCase(), { name: str(s.name, 40), role: str(s.role, 80), canonicalLook: str(s.canonicalLook, 400), personality: str(s.personality, 120), voice: s.voice ? str(s.voice, 30) : null })
  }
  return { recent, recurringCast: [...cast.values()].slice(-MEMORY_RECURRING) }
}

/**
 * A script that uses a recurring character's name without declaring it gets the saved look filled in, so the character is the same one as
 * before (its reference image comes back from the series library through the same name).
 */
export function hydrateRecurring(script: Script, memory: SeriesMemory, mainNames: string[]): Script {
  const declared = new Set([...mainNames, ...script.supportingCast.map((s) => s.name)].map((n) => n.toLowerCase()))
  const used = new Set(script.beats.map((b) => b.speaker?.toLowerCase()).filter(Boolean) as string[])
  const add = memory.recurringCast.filter((c) => used.has(c.name.toLowerCase()) && !declared.has(c.name.toLowerCase()))
  if (!add.length) return script
  return { ...script, supportingCast: [...script.supportingCast, ...add.map((c) => ({ name: c.name, role: c.role, canonicalLook: c.canonicalLook, personality: c.personality, voice: c.voice, recurring: true }))] }
}

/** The compact version for the episode block of a prompt. */
export function memoryBrief(memory: SeriesMemory) {
  return {
    recentReels: memory.recent.map((e) => ({ title: e.title, premise: e.premise, ...(e.vibe ? { vibe: e.vibe } : {}) })),
    // the vibes of the last two reels: the next one should feel different
    recentVibes: memory.recent.map((e) => e.vibe).filter(Boolean).slice(0, 2),
    runningGagsSoFar: memory.recent.map((e) => e.runningGag).filter(Boolean),
    recurringCharactersYouMayReuse: memory.recurringCast.map((c) => ({ name: c.name, role: c.role, look: c.canonicalLook, personality: c.personality })),
  }
}

/** Idea titles that must not be used again: the remembered ones plus any extra (episodes made before the memory existed, ideas the user rejected). */
export function avoidTitlesFrom(memory: SeriesMemory, extra: string[] = []): string[] {
  const seen = new Set<string>()
  return [...memory.recent.map((e) => e.title), ...extra].filter((t) => { const k = t.trim().toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true })
}

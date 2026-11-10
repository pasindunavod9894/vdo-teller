import { STYLE_CATALOGUE } from '@/lib/styles/catalogue'

// Mock option generators for Phase 3. Phase 4 replaces these with the Showrunner agent's research.
export type Status = 'recommended' | 'suitable' | 'not_suitable'

export type SubNiche = { id: string; name: string; blurb: string; popularity: number; trend: 'rising' | 'stable' | 'falling'; monetization: string }
export type StyleOption = { id: string; name: string; look: string; status: Status; why: string }
export type CharacterIdea = { id: string; name: string; role: string; look: string; personality: string }
export type VoiceOption = { id: 'none' | 'narrator' | 'character_voices' | 'narrator_and_characters'; name: string; blurb: string; status: Status; why: string }

export type Kind = 'animals' | 'kids' | 'finance' | 'generic'

export function detectKind(niche: string): Kind {
  const n = niche.toLowerCase()
  if (/(cat|dog|pet|animal|puppy|kitten|bird)/.test(n)) return 'animals'
  if (/(kid|bedtime|children|fairy|nursery)/.test(n)) return 'kids'
  if (/(financ|money|invest|budget|crypto|business|saving)/.test(n)) return 'finance'
  return 'generic'
}

export function subNichesFor(niche: string): SubNiche[] {
  const kind = detectKind(niche)
  const t = niche.replace(/\s*videos?$/i, '').trim() || niche
  const base: Record<Kind, SubNiche[]> = {
    animals: [
      { id: 'funny', name: `Funny ${t}`, blurb: 'Quick comedy moments and mishaps', popularity: 92, trend: 'stable', monetization: 'High reach, easy to monetize on Facebook Reels' },
      { id: 'family-drama', name: `${t} family drama`, blurb: 'Recurring cast with ongoing story arcs', popularity: 86, trend: 'rising', monetization: 'Strong follower loyalty and watch time' },
      { id: 'thug-life', name: `"Thug life" ${t}`, blurb: 'Tough-guy characters, meme energy', popularity: 78, trend: 'rising', monetization: 'Shareable, good for fast growth' },
      { id: 'cafe', name: `${t} café life`, blurb: 'Cosy slice-of-life in a themed setting', popularity: 74, trend: 'stable', monetization: 'Steady views, brand-friendly' },
    ],
    kids: [
      { id: 'bedtime', name: 'Bedtime stories', blurb: 'Calm narrated tales with soft visuals', popularity: 90, trend: 'stable', monetization: 'Long watch time on YouTube' },
      { id: 'moral', name: 'Moral fables', blurb: 'Short stories with a lesson', popularity: 80, trend: 'stable', monetization: 'Evergreen content' },
      { id: 'adventure', name: 'Animal adventures', blurb: 'Friends on small quests', popularity: 76, trend: 'rising', monetization: 'Series-friendly' },
    ],
    finance: [
      { id: 'budgeting', name: 'Budgeting tips', blurb: 'Simple money habits explained', popularity: 84, trend: 'stable', monetization: 'High CPM on YouTube' },
      { id: 'myths', name: 'Money myths', blurb: 'Busting common beliefs', popularity: 79, trend: 'rising', monetization: 'Good engagement' },
      { id: 'rich-poor', name: 'Rich vs poor stories', blurb: 'Story-driven comparisons', popularity: 82, trend: 'rising', monetization: 'Highly shareable' },
      { id: 'side-hustles', name: 'Side hustles', blurb: 'Ideas to earn extra income', popularity: 77, trend: 'stable', monetization: 'Strong on Facebook and YouTube' },
    ],
    generic: [
      { id: 'stories', name: `${t} stories`, blurb: 'Story-led episodes with recurring characters', popularity: 85, trend: 'rising', monetization: 'Best for loyal audiences' },
      { id: 'facts', name: `${t} facts`, blurb: 'Quick surprising facts', popularity: 80, trend: 'stable', monetization: 'Fast to produce, wide reach' },
      { id: 'funny', name: `Funny ${t}`, blurb: 'Light comedy takes', popularity: 76, trend: 'stable', monetization: 'Shareable reels' },
    ],
  }
  return base[kind]
}

const CATALOGUE = STYLE_CATALOGUE

const STYLE_MAP: Record<Kind, { recommended: string[]; suitable: string[] }> = {
  animals: { recommended: ['realistic', 'pixar-3d', 'disney-classic'], suitable: ['anime', 'storybook', 'claymation', 'cartoon-2d'] },
  kids: { recommended: ['disney-classic', 'storybook', 'pixar-3d'], suitable: ['claymation', 'cartoon-2d'] },
  finance: { recommended: ['explainer', 'kinetic'], suitable: ['pixar-3d', 'documentary', 'cartoon-2d'] },
  generic: { recommended: ['pixar-3d', 'cartoon-2d'], suitable: ['anime', 'storybook', 'documentary', 'comic', 'explainer', 'realistic'] },
}

export function stylesFor(niche: string): StyleOption[] {
  const m = STYLE_MAP[detectKind(niche)]
  return CATALOGUE.map((s) => {
    const status: Status = m.recommended.includes(s.id) ? 'recommended' : m.suitable.includes(s.id) ? 'suitable' : 'not_suitable'
    const why =
      status === 'recommended' ? 'Performs best for this niche'
      : status === 'suitable' ? 'Works well, less proven here'
      : 'Weak fit for this niche'
    return { ...s, status, why }
  }).sort((a, b) => ({ recommended: 0, suitable: 1, not_suitable: 2 })[a.status] - ({ recommended: 0, suitable: 1, not_suitable: 2 })[b.status])
}

export function charactersFor(niche: string): CharacterIdea[] {
  const kind = detectKind(niche)
  const sets: Record<Kind, CharacterIdea[]> = {
    animals: [
      { id: 'duo', name: 'Mango & Luna', role: 'Duo', look: 'Two contrasting pets, one bold and one nervous', personality: 'Bold schemer + anxious sidekick' },
      { id: 'family', name: 'The Whiskers family', role: 'Family', look: 'Parent, two kids and a grumpy grandparent', personality: 'Warm, chaotic, relatable' },
      { id: 'solo', name: 'Chef Biscuit', role: 'Solo star', look: 'One expressive pet with a signature outfit', personality: 'Confident and clumsy' },
    ],
    kids: [
      { id: 'narrator', name: 'Storyteller Fox', role: 'Narrator', look: 'A gentle fox with a lantern', personality: 'Calm and kind' },
      { id: 'friends', name: 'Pip & Bo', role: 'Duo', look: 'Two small forest friends', personality: 'Curious and brave' },
    ],
    finance: [
      { id: 'mentor', name: 'Coin the owl', role: 'Mentor mascot', look: 'A wise owl with a tiny calculator', personality: 'Witty and clear' },
      { id: 'host', name: 'Narrator only', role: 'Narrator', look: 'No on-screen character', personality: 'Confident explainer voice' },
    ],
    generic: [
      { id: 'host', name: 'Series host', role: 'Narrator / mascot', look: 'A recognisable mascot for your niche', personality: 'Friendly and curious' },
      { id: 'duo', name: 'The duo', role: 'Duo', look: 'Two contrasting characters', personality: 'Odd couple chemistry' },
    ],
  }
  return sets[kind]
}

export function voicesFor(niche: string): VoiceOption[] {
  const kind = detectKind(niche)
  const rec: Record<Kind, VoiceOption['id']> = { animals: 'character_voices', kids: 'narrator_and_characters', finance: 'narrator', generic: 'narrator' }
  const suitable: Record<Kind, VoiceOption['id'][]> = {
    animals: ['none', 'narrator', 'narrator_and_characters'], kids: ['narrator', 'character_voices'],
    finance: ['none', 'narrator_and_characters'], generic: ['none', 'character_voices', 'narrator_and_characters'],
  }
  const defs: Omit<VoiceOption, 'status' | 'why'>[] = [
    { id: 'none', name: 'No voice', blurb: 'Music, sound effects and on-screen text only' },
    { id: 'narrator', name: 'Narrator', blurb: 'One storyteller voice-over' },
    { id: 'character_voices', name: 'Character voices', blurb: 'Characters talk on screen with lip-sync and expressions' },
    { id: 'narrator_and_characters', name: 'Narrator + characters', blurb: 'Both voices together' },
  ]
  return defs.map((d) => {
    const status: Status = d.id === rec[kind] ? 'recommended' : suitable[kind].includes(d.id) ? 'suitable' : 'not_suitable'
    return { ...d, status, why: status === 'recommended' ? 'Best fit for this niche' : status === 'suitable' ? 'Works well' : 'Weak fit' }
  })
}

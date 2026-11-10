import { z } from 'zod'
import { STYLE_IDS } from '@/lib/styles/catalogue'

const status = z.enum(['recommended', 'suitable', 'not_suitable'])

export const SubNichesSchema = z.object({
  subNiches: z.array(z.object({
    id: z.string().describe('short kebab-case id'),
    name: z.string(),
    blurb: z.string().describe('one short sentence'),
    popularity: z.number().int().describe('0-100, how popular this is on Facebook/YouTube'),
    trend: z.enum(['rising', 'stable', 'falling']),
    monetization: z.string().describe('one short sentence on earning potential'),
  })).describe('3 to 6 sub-niches, most promising first. A single entry if the niche cannot be split.'),
})

export const OptionsSchema = z.object({
  styles: z.array(z.object({ id: z.enum(STYLE_IDS), status, why: z.string() })).describe('one entry for EVERY style id'),
  voices: z.array(z.object({ id: z.enum(['none', 'narrator', 'character_voices', 'narrator_and_characters']), status, why: z.string() })).describe('one entry for EVERY voice mode'),
  characters: z.array(z.object({
    id: z.string(), name: z.string(), role: z.string(), look: z.string(), personality: z.string(),
  })).describe('3 suggested casts or mascots; original characters only'),
})

export type SubNichesResult = z.infer<typeof SubNichesSchema>
export type OptionsResult = z.infer<typeof OptionsSchema>

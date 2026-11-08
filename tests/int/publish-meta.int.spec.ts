import { describe, expect, it } from 'vitest'
import { AI_LABEL, cleanTag, platformMeta, platformMetas, tidyTags } from '@/pipeline/publish-meta'

const publish = { title: 'Luna and the Plan', caption: 'Luna announces a plan nobody asked for. 😂', hashtags: ['#AnimatedStories', 'CatVideos', '#Shorts'], aiLabel: 'Made with AI' }

describe('publisher metadata', () => {
  it('cleans and de-duplicates hashtags, in order, up to a limit', () => {
    expect(cleanTag('cat videos!')).toBe('#catvideos')
    expect(cleanTag('##Fun_1')).toBe('#Fun_1')
    expect(tidyTags(['#A', 'a', '#B', '#', '#C'], 2)).toEqual(['#A', '#B'])
    expect(tidyTags(['#A'], 5, ['#Shorts'])).toEqual(['#A', '#Shorts'])
  })

  it('YouTube: #Shorts in the title and tags, title within 100 characters, AI label in the description', () => {
    const m = platformMeta(publish, 'youtube-shorts')
    expect(m.title).toBe('Luna and the Plan #Shorts')
    expect(m.hashtags).toContain('#Shorts')
    expect(m.hashtags.filter((t) => t.toLowerCase() === '#shorts')).toHaveLength(1)
    expect(m.description).toContain(publish.caption)
    expect(m.description).toContain(AI_LABEL)
    expect(m.note).toMatch(/synthetic/i)
    const long = platformMeta({ ...publish, title: 'x'.repeat(300) }, 'youtube-shorts')
    expect(long.title.length).toBeLessThanOrEqual(100)
    expect(long.title.endsWith(' #Shorts')).toBe(true)
    expect(platformMeta({ ...publish, title: 'Plan #Shorts' }, 'youtube-shorts').title).toBe('Plan #Shorts')
  })

  it('Facebook: a few hashtags, caption within the limit, AI label always present', () => {
    const many = { ...publish, hashtags: Array.from({ length: 12 }, (_, i) => `#tag${i}`) }
    const m = platformMeta(many, 'facebook-reels')
    expect(m.hashtags).toHaveLength(5)
    expect(m.description).toContain(AI_LABEL)
    const huge = platformMeta({ ...publish, caption: 'y'.repeat(5000) }, 'facebook-reels')
    expect(huge.description.length).toBeLessThanOrEqual(2200)
    expect(platformMeta({ ...publish, aiLabel: '' }, 'facebook-reels').description).toContain(AI_LABEL)
  })

  it('returns both platforms', () => {
    expect(platformMetas(publish).map((m) => m.platform)).toEqual(['youtube-shorts', 'facebook-reels'])
  })
})

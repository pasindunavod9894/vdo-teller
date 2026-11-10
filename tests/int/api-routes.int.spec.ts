import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { Characters } from '@/collections/Characters'
import { Episodes } from '@/collections/Episodes'
import { Series } from '@/collections/Series'
import { Users } from '@/collections/Users'
import { Media } from '@/collections/Media'
import { AssetPacks } from '@/collections/AssetPacks'
import { PipelineSteps } from '@/collections/PipelineSteps'
import { NicheResearchCache } from '@/collections/NicheResearchCache'

const API = path.resolve(__dirname, '../../src/app/(frontend)/api')
const slugs = [Characters, Episodes, Series, Users, Media, AssetPacks, PipelineSteps, NicheResearchCache].map((c) => c.slug)

describe('app routes and Payload\'s own REST routes', () => {
  it('no app route sits at /api/<collection>, because it would shadow the REST route Payload serves there (signup posts to /api/characters and /api/series)', () => {
    expect(slugs).toEqual(expect.arrayContaining(['characters', 'series', 'users']))
    for (const slug of slugs) {
      expect(fs.existsSync(path.join(API, slug, 'route.ts')), `src/app/(frontend)/api/${slug}/route.ts shadows Payload's /api/${slug}`).toBe(false)
    }
  })

  it('the cast routes are under /api/cast', () => {
    expect(fs.existsSync(path.join(API, 'cast', 'characters', 'route.ts'))).toBe(true)
    expect(fs.existsSync(path.join(API, 'cast', 'check', 'route.ts'))).toBe(true)
  })
})

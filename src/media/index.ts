import { createMockMedia } from './mock'
import { createOpenAIMedia } from './openai'
import type { MediaServices } from './types'
import type { Quality } from '../lib/art/plan'

export type MediaProviderName = 'mock' | 'openai'

/** Real media only when explicitly asked for AND a key exists, so nothing is ever spent by accident. */
export function mediaProvider(): MediaProviderName {
  return process.env.MEDIA_PROVIDER === 'openai' && process.env.OPENAI_API_KEY ? 'openai' : 'mock'
}

export function createMedia(dirs: { assetsDir: string; libraryDir: string }, provider: MediaProviderName = mediaProvider(), opts: { quality?: Quality } = {}): MediaServices {
  return provider === 'openai' ? createOpenAIMedia({ ...dirs, quality: opts.quality }) : createMockMedia(dirs)
}

export type { MediaServices, SpeechSpec, SpeechResult, PlateResult, GateResult } from './types'

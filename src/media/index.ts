import { createMockMedia } from './mock'
import { createOpenAIMedia } from './openai'
import type { MediaServices } from './types'

export type MediaProviderName = 'mock' | 'openai'

/** Real media only when explicitly asked for AND a key exists, so nothing is ever spent by accident. */
export function mediaProvider(): MediaProviderName {
  return process.env.MEDIA_PROVIDER === 'openai' && process.env.OPENAI_API_KEY ? 'openai' : 'mock'
}

export function createMedia(dirs: { assetsDir: string; libraryDir: string; width?: number; height?: number }, provider: MediaProviderName = mediaProvider()): MediaServices {
  return provider === 'openai' ? createOpenAIMedia(dirs) : createMockMedia(dirs)
}

export type { MediaServices, SpeechSpec, SpeechResult, PlateResult, GateResult, KeyframeSpec, KeyframeResult, ReferenceSpec, ReferenceResult, ContinuitySpec, ContinuityResult, ReelQaSpec, ReelQaResult } from './types'

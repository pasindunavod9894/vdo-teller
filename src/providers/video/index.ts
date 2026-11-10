import { generateClip, generateMockClip, type ClipRequest, type ClipResult } from './fal'
import { generateLipsync, generateMockLipsync, type LipsyncRequest, type LipsyncResult } from './lipsync'

export type VideoProviderName = 'fal' | 'mock'

/** `fal` only when explicitly asked for AND a key exists; otherwise the free mock, so nothing is ever spent by accident. */
export function videoProvider(): VideoProviderName {
  return process.env.VIDEO_PROVIDER === 'fal' && process.env.FAL_KEY ? 'fal' : 'mock'
}

export async function makeClip(req: ClipRequest): Promise<ClipResult> {
  return videoProvider() === 'fal' ? generateClip(req) : generateMockClip(req)
}

/** Lip-syncs a dialogue clip with the same provider switch as the clips themselves. */
export async function makeLipsync(req: LipsyncRequest): Promise<LipsyncResult> {
  return videoProvider() === 'fal' ? generateLipsync(req) : generateMockLipsync(req)
}

export { generateClip, generateMockClip } from './fal'
export { generateLipsync, generateMockLipsync } from './lipsync'
export type { LipsyncRequest, LipsyncResult } from './lipsync'
export type { ClipRequest, ClipResult } from './fal'

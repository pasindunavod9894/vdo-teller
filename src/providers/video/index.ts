import { generateClip, generateMockClip, type ClipRequest, type ClipResult } from './fal'

export type VideoProviderName = 'fal' | 'mock'

/** `fal` only when explicitly asked for AND a key exists; otherwise the free mock, so nothing is ever spent by accident. */
export function videoProvider(): VideoProviderName {
  return process.env.VIDEO_PROVIDER === 'fal' && process.env.FAL_KEY ? 'fal' : 'mock'
}

export async function makeClip(req: ClipRequest): Promise<ClipResult> {
  return videoProvider() === 'fal' ? generateClip(req) : generateMockClip(req)
}

export { generateClip, generateMockClip } from './fal'
export type { ClipRequest, ClipResult } from './fal'

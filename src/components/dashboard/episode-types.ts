/** Plain, serialisable data the server page hands to the review and "needs a look" components. */

export type ReviewBeat = { n: number; action: string; speaker: string | null; line: string | null }
export type ReviewIdea = { title: string; premise: string; hook: string; emotionalCore: string }
export type ReviewShot = { n: number; /** the camera angle, or the shot type when there is none */ caption: string }
export type ReviewData = {
  title: string
  idea: ReviewIdea | null
  /** the ideas the Creator proposed and the Story Builder did not choose */
  otherIdeas: { title: string; premise: string }[]
  beats: ReviewBeat[]
  shots: ReviewShot[]
  /** spent so far (text and pictures) */
  costUsd: number
  /** what making the clips is expected to cost */
  videoEstimateUsd: number
}

export type QaFlagKind = 'captions' | 'frame' | 'text' | 'character' | 'other'
export type QaFlag = { shot: number; kind: QaFlagKind; issue: string }
export type QaData = {
  flags: QaFlag[]
  /** the shot being remade right now, or null */
  fixing: { shot: number; at: string } | null
  fixError: string | null
  /** expected price of remaking each flagged shot, by shot number */
  estimates: Record<number, number>
}

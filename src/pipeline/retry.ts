import type { ContinueState, Resume } from './orchestrator'
import type { EpisodeStyle, Idea, Script, ShotList } from './schemas'
import { STEPS, type StepKey } from './steps'

/** What a failed episode saved while it ran. Everything is optional: a run can stop at any step. */
export type SavedEpisode = { idea?: unknown; script?: unknown; critique?: unknown; shots?: unknown; styleNotes?: unknown }

/** The idea, script, shots and style notes an episode saved. Null if any of them is missing or malformed. */
export function savedEpisodeParts(episode: SavedEpisode): ContinueState | null {
  const idea = episode.idea as Idea | undefined
  const script = episode.script as Script | undefined
  const shots = episode.shots as ShotList | undefined
  if (!idea?.title || !Array.isArray(script?.beats) || !Array.isArray(shots?.shots) || !shots.shots.length) return null
  return { idea, script: script as Script, shots, epStyle: (episode.styleNotes as EpisodeStyle | undefined) ?? undefined }
}

/** The approved idea and script of this very episode, or null when it never got that far. */
export function ownResume(episode: SavedEpisode): Resume | null {
  const idea = episode.idea as Idea | undefined
  const script = episode.script as Script | undefined
  const approved = (episode.critique as { approved?: unknown } | null | undefined)?.approved === true
  return idea?.title && idea.premise && Array.isArray(script?.beats) && script.beats.length > 0 && approved ? { idea, script: script as Script } : null
}

/**
 * Where a retry of a failed episode picks up, from what the episode saved:
 *  - 'editor': the story, shots and keyframes are there, so only the clips, the assembly and the publisher are made;
 *  - 'script': the story was approved, so the idea and the script are reused and the Art Director step runs again;
 *  - 'start': nothing worth keeping, so the episode runs again from the beginning (on the same video).
 * The caller falls back from 'editor' to 'script' when the saved keyframes are gone from disk.
 */
export type RetryPlan = 'editor' | 'script' | 'start'
export function retryPlan(episode: SavedEpisode): RetryPlan {
  if (savedEpisodeParts(episode)) return 'editor'
  if (ownResume(episode)) return 'script'
  return 'start'
}

/** What the retry button says: the agent whose step the run stopped in, or a plain "Try again" when it stopped before any of them. */
export function retryLabel(failedStep: string | null | undefined): string {
  const step = STEPS.find((s) => s.key === (failedStep as StepKey))
  return step && step.agent !== 'Orchestrator' ? `Retry from ${step.agent}` : 'Try again'
}

/** The step a failed episode stopped in: the first step row that failed. */
export const failedStepOf = (steps: { stepKey?: string | null; status?: string | null }[]): string | null => steps.find((s) => s.status === 'failed')?.stepKey ?? null

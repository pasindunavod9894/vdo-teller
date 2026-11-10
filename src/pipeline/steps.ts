export type StepKey =
  | 'orchestrator-plan' | 'creator' | 'story-builder' | 'style' | 'art-director' | 'editor-clips' | 'editor-assemble' | 'publisher' | 'orchestrator-final'

export type StepDef = { key: StepKey; agent: string; label: string }

// Fixed order (plan §3): a workflow, not an LLM, decides the order so progress, retries and cost limits are predictable.
export const STEPS: StepDef[] = [
  { key: 'orchestrator-plan', agent: 'Orchestrator', label: 'Planning the video' },
  { key: 'creator', agent: 'Creator', label: 'Finding the idea' },
  { key: 'story-builder', agent: 'Story Builder', label: 'Writing and reviewing the story' },
  { key: 'style', agent: 'Style', label: 'Setting the look of this video' },
  { key: 'art-director', agent: 'Art Director', label: 'Planning the shots and the keyframes' },
  { key: 'editor-clips', agent: 'Editor', label: 'Making the clips and the voices' },
  { key: 'editor-assemble', agent: 'Editor', label: 'Putting it together and checking it' },
  { key: 'publisher', agent: 'Publisher', label: 'Writing the title and caption' },
  { key: 'orchestrator-final', agent: 'Orchestrator', label: 'Finishing the video' },
]

export const MAX_REVISION_ROUNDS = 3
export const APPROVE_SCORE = 8

export type PipelineMode = 'mock' | 'text'
/** mock = every agent returns fixtures; text = real LLM text agents (Showrunner, Writer, Critic, Publisher), media agents still mock. */
export const pipelineMode = (): PipelineMode => (process.env.PIPELINE_MODE === 'text' && process.env.OPENAI_API_KEY ? 'text' : 'mock')

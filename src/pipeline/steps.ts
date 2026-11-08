export type StepKey =
  | 'orchestrator-plan' | 'showrunner' | 'writer' | 'critic' | 'art-director' | 'animator' | 'editor-qa' | 'publisher' | 'orchestrator-final'

export type StepDef = { key: StepKey; agent: string; label: string }

// Fixed order (plan §3): a workflow, not an LLM, decides the order so progress, retries and cost limits are predictable.
export const STEPS: StepDef[] = [
  { key: 'orchestrator-plan', agent: 'Orchestrator', label: 'Planning the episode' },
  { key: 'showrunner', agent: 'Showrunner', label: 'Choosing the episode idea' },
  { key: 'writer', agent: 'Writer', label: 'Writing the script' },
  { key: 'critic', agent: 'Critic', label: 'Reviewing the script' },
  { key: 'art-director', agent: 'Art Director', label: 'Planning the shots' },
  { key: 'animator', agent: 'Animator', label: 'Building the timeline and voices' },
  { key: 'editor-qa', agent: 'Editor-QA', label: 'Checking quality' },
  { key: 'publisher', agent: 'Publisher', label: 'Writing title and caption' },
  { key: 'orchestrator-final', agent: 'Orchestrator', label: 'Assembling the final episode' },
]

export const MAX_REVISION_ROUNDS = 3
export const APPROVE_SCORE = 8

export type PipelineMode = 'mock' | 'text'
/** mock = every agent returns fixtures; text = real LLM text agents (Showrunner, Writer, Critic, Publisher), media agents still mock. */
export const pipelineMode = (): PipelineMode => (process.env.PIPELINE_MODE === 'text' && process.env.OPENAI_API_KEY ? 'text' : 'mock')

import type { VoiceMode } from '../profile'

/** One agent's instructions: its role, and what it does differently for each voice mode (plan §3, "Agent initialisation prompts"). */
export type AgentPrompt = { role: string; voice?: Partial<Record<VoiceMode, string>> }

/** Bump when a prompt changes, so a run can say which wording produced a result. The prompt eval set must stay green. */
export const PROMPT_VERSION = 'r4-2'

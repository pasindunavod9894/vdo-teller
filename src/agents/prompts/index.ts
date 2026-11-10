import type { AgentName, VoiceMode } from '../profile'
import { artDirector } from './art-director'
import { creator, picker } from './creator'
import { editor } from './editor'
import { publisher } from './publisher'
import { reelQa } from './reel-qa'
import { styleNotes } from './style-notes'
import { critic, writer } from './story-builder'
import type { AgentPrompt } from './types'

export { PROMPT_VERSION } from './types'
export { REEL_QA_INSTRUCTIONS } from './reel-qa'

const orchestrator: AgentPrompt = { role: 'You are the Orchestrator. You split one episode into tasks, call sub-agents as tools, keep the state and assemble the final output. Sub-agents talk only to you.' }

export const PROMPTS: Record<AgentName, AgentPrompt> = { orchestrator, creator, picker, writer, critic, styleNotes, artDirector, editor, reelQa, publisher }

export const roleOf = (a: AgentName) => PROMPTS[a].role
/** What an agent does differently for a voice mode, or nothing. */
export const voiceRuleOf = (a: AgentName, mode: VoiceMode): string | undefined => PROMPTS[a].voice?.[mode]

import type { CharacterIdea, StyleOption, VoiceOption } from '@/lib/wizard/mock-data'

export type OptionsPayload = {
  styles: StyleOption[]; voices: VoiceOption[]; characters: CharacterIdea[]
}

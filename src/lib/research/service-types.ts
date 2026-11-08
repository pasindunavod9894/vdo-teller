import type { CharacterIdea, FormatOption, FrequencyOption, StyleOption, VoiceOption } from '@/lib/wizard/mock-data'

export type OptionsPayload = {
  styles: StyleOption[]; voices: VoiceOption[]; formats: FormatOption[]; characters: CharacterIdea[]; frequencies: FrequencyOption[]
}

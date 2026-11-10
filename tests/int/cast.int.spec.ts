import { describe, expect, it } from 'vitest'
import { allowedNames, castViolations, voiceForSupporting } from '@/pipeline/cast'
import { ScriptSchema, type Script, type ShotList } from '@/pipeline/schemas'

const supporting = (name: string, over = {}) => ({ name, role: 'shopkeeper', canonicalLook: 'a tall grey owl in an apron', personality: 'grumpy', voice: null, recurring: false, ...over })
const script = (over: Partial<Script> = {}): Script => ({
  title: 't', hook: 'h', payoff: 'p', supportingCast: [],
  beats: [{ n: 1, action: 'a', speaker: 'Mango', line: 'hi', emotion: null, delivery: null, expression: 'neutral' as const, onScreenText: null }, { n: 2, action: 'b', speaker: 'narrator', line: 'and so', emotion: null, delivery: null, expression: 'neutral' as const, onScreenText: null }],
  ...over,
})
const shots = (characters: string[][]): ShotList => ({ shots: characters.map((c, i) => ({ n: i + 1, type: 'dialogue' as const, description: 'd', durationSec: 3, characters: c, beat: 1, videoSeconds: 5, keyframePrompt: 'k', motionPrompt: 'm' })) })
const MAIN = ['Mango', 'Luna']

describe('cast rule', () => {
  it('allows the main cast, the narrator and the supporting characters the script declares', () => {
    expect(castViolations(MAIN, script())).toEqual([])
    const s = script({ supportingCast: [supporting('Grumble')], beats: [{ n: 1, action: 'a', speaker: 'Grumble', line: 'hm', emotion: null, delivery: null, expression: 'neutral' as const, onScreenText: null }] })
    expect(castViolations(MAIN, s, shots([['Mango', 'Grumble']]))).toEqual([])
    expect([...allowedNames(MAIN, s)]).toEqual(['Mango', 'Luna', 'Grumble'])
  })

  it('rejects a speaker or a shot character nobody declared', () => {
    const bad = script({ beats: [{ n: 1, action: 'a', speaker: 'Stranger', line: 'hi', emotion: null, delivery: null, expression: 'neutral' as const, onScreenText: null }] })
    expect(castViolations(MAIN, bad)).toEqual(['Beat 1: "Stranger" is not in the cast.'])
    expect(castViolations(MAIN, script(), shots([['Mango'], ['Intruder']]))).toEqual(['Shot 2: "Intruder" is not in the cast.'])
  })

  it('rejects a supporting character that reuses a main name or another supporting name, and a reel with no main character', () => {
    expect(castViolations(MAIN, script({ supportingCast: [supporting('Mango')] })).join(' ')).toMatch(/same name as a main character/)
    expect(castViolations(MAIN, script({ supportingCast: [supporting('Owl'), supporting('owl')] })).join(' ')).toMatch(/share a name/)
    const s = script({ supportingCast: [supporting('Owl')] })
    expect(castViolations(MAIN, s, shots([['Owl'], ['Owl']]))).toEqual(['No shot features a main character.'])
  })

  it('has a schema that requires the supporting cast to be declared (an empty list when there is none)', () => {
    const ok = ScriptSchema.safeParse({ ...script() })
    expect(ok.success).toBe(true)
    const { supportingCast: _drop, ...without } = script()
    void _drop
    expect(ScriptSchema.safeParse(without).success).toBe(false)
  })
})

describe('voices for supporting characters', () => {
  it('uses the requested voice when it is a real one', () => {
    expect(voiceForSupporting('onyx', ['coral'])).toBe('onyx')
  })
  it('picks one nobody in the main cast uses, and never the storybook narrator voice', () => {
    const v = voiceForSupporting(null, ['alloy', 'ash', 'ballad', 'coral'])
    expect(['alloy', 'ash', 'ballad', 'coral', 'fable']).not.toContain(v)
    expect(voiceForSupporting('not-a-voice', [])).not.toBe('not-a-voice')
  })
})

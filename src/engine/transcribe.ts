import fs from 'node:fs'
import OpenAI from 'openai'

export type Word = { text: string; startSec: number; endSec: number }

/** Real word timings via whisper-1 (about $0.006 per minute of audio). */
export async function transcribeWords(file: string, client: OpenAI = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })): Promise<Word[]> {
  const r = (await client.audio.transcriptions.create({
    file: fs.createReadStream(file), model: 'whisper-1', response_format: 'verbose_json', timestamp_granularities: ['word'],
  })) as unknown as { words?: { word: string; start: number; end: number }[] }
  return (r.words ?? []).map((w) => ({ text: w.word.trim(), startSec: w.start, endSec: w.end }))
}

/**
 * Maps recognised words onto the words of the known script line (the script is the truth, recognition only supplies the
 * times). If the counts differ, the recognised words are stretched evenly over the script words.
 */
export function alignToScript(scriptText: string, recognised: Word[], clipStartSec: number): Word[] {
  const words = scriptText.split(/\s+/).filter(Boolean)
  if (!recognised.length) return []
  const pick = (i: number) => {
    const j = recognised.length === words.length ? i : Math.min(recognised.length - 1, Math.round((i / Math.max(1, words.length - 1)) * (recognised.length - 1)))
    return recognised[j]
  }
  return words.map((text, i) => {
    const r = pick(i)
    return { text, startSec: clipStartSec + r.startSec, endSec: clipStartSec + r.endSec }
  })
}

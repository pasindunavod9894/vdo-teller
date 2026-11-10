import fs from 'node:fs'
import path from 'node:path'
import { EXPRESSIONS } from '../lib/art/plan'
import { closestExpression } from '../lib/expressions'
import { colourFor, placeholderPng } from './placeholder'
import { safeName } from './workspace'

/**
 * A character kit (plan R1-B): the reference images that keep one character on-model. Built once per character when the
 * series is created, then locked; every keyframe of every reel is an image edit that is given these files as references.
 * File names are relative to an assets folder.
 */
export type CharacterKit = {
  name: string
  /** the reference sheet: front, three-quarter and side views of the whole character */
  sheet: string
  /** head-and-shoulders close-ups by expression: neutral, happy, surprised and sad, and the extra ones of the series (scared, proud...) */
  expressions: Record<string, string>
}

/** The files a keyframe edit gets for this character, most useful first. `max` keeps the request small. */
export function kitReferences(k: CharacterKit, max = 3): string[] {
  return [k.sheet, k.expressions.neutral, ...Object.values(k.expressions).filter((f) => f !== k.expressions.neutral)].filter(Boolean).slice(0, max)
}

/** The close-up that shows `expression`: the exact one when the character has it, else the nearest one it has (scared becomes surprised, and so on). */
export function kitFace(k: CharacterKit, expression: string): string {
  const names = Object.keys(k.expressions)
  return k.expressions[closestExpression(expression, names)] ?? k.sheet
}

/** Every file a kit refers to (for copying into an episode workspace). */
export function kitFiles(k: CharacterKit): string[] {
  return [k.sheet, ...Object.values(k.expressions)]
}

export function copyKit(k: CharacterKit, fromDir: string, toDir: string): CharacterKit {
  fs.mkdirSync(toDir, { recursive: true })
  for (const f of kitFiles(k)) if (path.resolve(fromDir, f) !== path.resolve(toDir, f)) fs.copyFileSync(path.join(fromDir, f), path.join(toDir, f))
  return k
}

/** Free placeholder kit: flat coloured figures with the same file roles as a real kit, so the pipeline runs with no spending. */
export async function buildMockKit(name: string, outDir: string, faces: readonly string[] = EXPRESSIONS): Promise<CharacterKit> {
  fs.mkdirSync(outDir, { recursive: true })
  const n = safeName(name)
  const colour = colourFor(name)
  const sheet = `${n}-sheet.png`
  await placeholderPng(path.join(outDir, sheet), { width: 768, height: 512, colour, shape: 'character' })
  const expressions: Record<string, string> = {}
  for (const [i, e] of faces.entries()) {
    const f = `${n}-expr-${e}.png`
    await placeholderPng(path.join(outDir, f), { width: 512, height: 512, colour, shape: 'face', variant: i })
    expressions[e] = f
  }
  return { name, sheet, expressions }
}

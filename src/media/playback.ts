import path from 'node:path'

/** Resolves the master file of an episode, refusing anything that would leave the episode's own folder. */
export function resolveMaster(episodeDir: string, relative: unknown): string | null {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) return null
  const root = path.resolve(episodeDir)
  const file = path.resolve(root, relative)
  return file.startsWith(root + path.sep) ? file : null
}

export type ByteRange = { start: number; end: number }

/**
 * Parses a single `Range: bytes=a-b` header (what browsers send to seek in a video). Returns null for no header,
 * 'invalid' when it cannot be satisfied (the caller answers 416).
 */
export function parseRange(header: string | null, size: number): ByteRange | null | 'invalid' {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid'
  let start: number
  let end: number
  if (m[1] === '') { // suffix: the last N bytes
    const n = Number(m[2])
    if (n === 0) return 'invalid'
    start = Math.max(0, size - n); end = size - 1
  } else {
    start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  }
  if (start >= size || start > end) return 'invalid'
  return { start, end }
}

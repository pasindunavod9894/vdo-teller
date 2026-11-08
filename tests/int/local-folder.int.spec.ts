import { describe, expect, it } from 'vitest'
import { checkFolder, classifyFolderError, episodeFileName, listVideos, localVideoUrl, openSeriesDir, ROOT_NAME, slugify, syncEpisodes, type DirLike, type WritableLike } from '@/lib/local-folder/folder'
import { isSeriesAction, seriesPatch } from '@/lib/series-state'

const domErr = (name: string) => Object.assign(new Error(name), { name })

/** An in-memory folder that behaves like the browser's: files appear only once fully written, and a deleted folder throws NotFoundError. */
function memDir(name = 'picked', state = { gone: false, perm: 'granted' as 'granted' | 'prompt' | 'denied', failWriteFor: '' }, files = new Map<string, Uint8Array>(), dirs = new Map<string, DirLike>()): DirLike & { files: Map<string, Uint8Array>; state: typeof state } {
  const check = () => { if (state.gone) throw domErr('NotFoundError') }
  return {
    name, files, state,
    getDirectoryHandle: async (n, o) => { check(); if (!dirs.has(n)) { if (!o?.create) throw domErr('NotFoundError'); dirs.set(n, memDir(n, state)) } return dirs.get(n)! },
    getFileHandle: async (n, o) => {
      check()
      if (!files.has(n) && !o?.create) throw domErr('NotFoundError')
      return {
        getFile: async () => new File([files.get(n) ?? new Uint8Array()], n),
        createWritable: async (): Promise<WritableLike> => {
          const chunks: Uint8Array[] = []
          return {
            write: async (d) => { if (state.failWriteFor && n.includes(state.failWriteFor)) throw new Error('disk full'); chunks.push(d) },
            close: async () => { files.set(n, Uint8Array.from(chunks.flatMap((c) => [...c]))) },
            abort: async () => {},
          }
        },
      }
    },
    values: () => ({ async *[Symbol.asyncIterator]() { check(); for (const f of files.keys()) yield { kind: 'file' as const, name: f } } }),
    queryPermission: async () => state.perm,
    requestPermission: async () => { state.perm = 'granted'; return 'granted' as const },
  }
}

const video = (bytes: number[]) => async () => new Response(new Uint8Array(bytes))

describe('local folder', () => {
  it('makes "VDO Teller/<series>" inside the picked folder, and reuses an existing VDO Teller folder', async () => {
    const picked = memDir('Movies')
    const s = await openSeriesDir(picked, 'Cat Café Life!')
    expect(s.name).toBe('cat-caf-life')
    expect((await picked.getDirectoryHandle(ROOT_NAME)).name).toBe(ROOT_NAME)
    const inRoot = memDir(ROOT_NAME)
    expect((await openSeriesDir(inRoot, 'Money Tips')).name).toBe('money-tips')
    expect((await inRoot.getDirectoryHandle('money-tips')).name).toBe('money-tips')
  })

  it('names files by episode and slug, and classifies browser errors', () => {
    expect(episodeFileName({ id: 7, title: 'Luna & the Plan' })).toBe('episode-7-luna-the-plan.mp4')
    expect(slugify('')).toBe('series')
    expect(classifyFolderError(domErr('NotFoundError'))).toBe('missing')
    expect(classifyFolderError(domErr('NotAllowedError'))).toBe('denied')
    expect(classifyFolderError(domErr('AbortError'))).toBe('cancelled')
    expect(classifyFolderError(new Error('x'))).toBe('other')
  })

  it('copies finished episodes once, skips ones already saved and ones without a video', async () => {
    const dir = memDir()
    const eps = [{ id: 1, title: 'One', hasVideo: true, meta: { caption: 'hi' } }, { id: 2, title: 'Two', hasVideo: false }, { id: 3, title: 'Three', hasVideo: true }]
    let calls = 0
    const dl = async (id: number | string) => { calls++; return new Response(new Uint8Array([Number(id), 9])) }
    const r = await syncEpisodes(dir, eps, dl)
    expect(r.saved).toEqual([1, 3])
    expect(dir.files.get('episode-1-one.mp4')).toEqual(new Uint8Array([1, 9]))
    expect(JSON.parse(new TextDecoder().decode(dir.files.get('episode-1-one.json')))).toEqual({ caption: 'hi' })
    expect([...(await listVideos(dir))].sort()).toEqual(['episode-1-one.mp4', 'episode-3-three.mp4'])
    await syncEpisodes(dir, eps, dl)
    expect(calls).toBe(2) // nothing is downloaded twice
  })

  it('reports a failed download or write without stopping the others', async () => {
    const dir = memDir()
    dir.state.failWriteFor = 'bad'
    const r = await syncEpisodes(dir, [{ id: 1, title: 'bad one', hasVideo: true }, { id: 2, title: 'ok', hasVideo: true }], video([1, 2]))
    expect(r.saved).toEqual([2])
    expect(r.failed).toEqual([{ id: 1, message: 'disk full' }])
    expect(dir.files.has('episode-1-bad-one.mp4')).toBe(false) // never half-written
    const r2 = await syncEpisodes(memDir(), [{ id: 5, title: 'x', hasVideo: true }], async () => new Response('no', { status: 404 }))
    expect(r2.failed[0].message).toMatch(/404/)
  })

  it('a deleted folder surfaces as "missing", checked and during sync', async () => {
    const dir = memDir()
    expect(await checkFolder(dir)).toBe('ok')
    dir.state.perm = 'prompt'
    expect(await checkFolder(dir)).toBe('needs-permission')
    await dir.requestPermission!({ mode: 'readwrite' })
    expect(await checkFolder(dir)).toBe('ok')
    dir.state.gone = true
    expect(await checkFolder(dir)).toBe('missing')
    await expect(syncEpisodes(dir, [{ id: 1, title: 'a', hasVideo: true }], video([1]))).rejects.toMatchObject({ name: 'NotFoundError' })
  })

  it('gives a playable URL for a saved episode and null for one that is not there', async () => {
    const dir = memDir()
    URL.createObjectURL = () => 'blob:fake'
    await syncEpisodes(dir, [{ id: 1, title: 'a', hasVideo: true }], video([1, 2, 3]))
    expect(await localVideoUrl(dir, { id: 1, title: 'a' })).toBe('blob:fake')
    expect(await localVideoUrl(dir, { id: 2, title: 'b' })).toBeNull()
  })
})

describe('series actions', () => {
  it('maps each action to a small, safe change', () => {
    expect(seriesPatch('link-folder')).toEqual({ folderLinked: true, status: 'active' })
    expect(seriesPatch('unlink-folder')).toEqual({ folderLinked: false })
    expect(seriesPatch('remove')).toEqual({ status: 'removed' })
    expect(seriesPatch('restore')).toEqual({ status: 'active' })
    expect(isSeriesAction('remove')).toBe(true)
    expect(isSeriesAction('delete-everything')).toBe(false)
    expect(isSeriesAction(undefined)).toBe(false)
  })
})

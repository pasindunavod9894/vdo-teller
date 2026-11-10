import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getPayload, type Payload } from 'payload'
import config from '@/payload.config'
import { castCharacterFrom, castProblems, characterProblems, characterRecords, cleanCharacter, cleanText, LIMITS, MAX_MAIN_CHARACTERS, uniqueCharacterId } from '@/lib/characters'
import { addCharacter, CharacterError, removeCharacter, vetCharacter, vetCharacterHook, type VetContext } from '@/lib/art/characters'
import type { User } from '@/payload-types'

const ok = { name: 'Pip', role: 'the clumsy one', look: 'a small round otter with a red scarf', outfit: 'a tiny red scarf', personality: 'shy, curious, brave' }

describe('writing a character', () => {
  it('cleans what a person typed: no control characters or angle brackets, single spaces, cut to length', () => {
    expect(cleanText('  Hi\u0000 <b>there</b>\n\n  you ', 40)).toBe('Hi b there /b you')
    expect(cleanText(42, 10)).toBe('')
    expect(cleanText('x'.repeat(500), 10)).toHaveLength(10)
    const c = cleanCharacter({ ...ok, name: ' Pip<script> ', look: 'a'.repeat(900) })
    expect(c.name).toBe('Pip script')
    expect(c.look).toHaveLength(LIMITS.lookMax)
  })

  it('needs a name and a look, and refuses studios, brands and famous characters (but not ordinary names)', () => {
    expect(characterProblems(ok)).toEqual([])
    expect(characterProblems({ ...ok, name: 'P' })[0]).toMatch(/Give the character a name/)
    expect(characterProblems({ ...ok, look: 'cute' })[0]).toMatch(/Describe what the character looks like/)
    expect(characterProblems({ ...ok, name: 'Mickey Mouse' })[0]).toMatch(/names a studio, brand or existing character/)
    expect(characterProblems({ ...ok, look: 'a pikachu with a hat' })[0]).toMatch(/The look names/)
    expect(characterProblems({ ...ok, outfit: 'a disney princess dress' })[0]).toMatch(/The outfit names/)
    for (const fine of ['Mickey', 'Nemo', 'Elsa', 'Luna', 'Mango']) expect(characterProblems({ ...ok, name: fine })).toEqual([])
    // words people use every day must never be refused: the AI casts write them all the time
    for (const look of ['a goofy golden puppy with floppy ears', 'a small bluey-grey cat with green eyes', 'a frozen lake spirit with icy hair', 'a clumsy bat with a tiny cape', 'a sonic boom of a hedgehog with spiky fur']) {
      expect(characterProblems({ ...ok, look }), look).toEqual([])
    }
    expect(characterProblems({ ...ok, look: 'a batman-style hero with a cape' })[0]).toMatch(/names a studio/) // a whole famous name is still refused
  })

  it('judges a cast: one to three characters, each with its own name, each valid', () => {
    expect(castProblems([ok])).toEqual([])
    expect(castProblems([])[0]).toMatch(/at least one/)
    expect(castProblems([ok, ok, ok, ok]).join(' ')).toMatch(new RegExp(`at most ${MAX_MAIN_CHARACTERS}`))
    expect(castProblems([ok, { ...ok, name: 'PIP' }])[0]).toMatch(/same name/)
    expect(castProblems([ok, { ...ok, name: 'Rex', look: 'dog' }])[0]).toMatch(/^Character 2: Describe what/)
  })

  it('makes an id that is not taken, and builds the wizard character with a suggested voice', () => {
    expect(uniqueCharacterId('Pip the Brave', [])).toBe('pip-the-brave')
    expect(uniqueCharacterId('Pip', ['pip', 'pip-2'])).toBe('pip-3')
    expect(uniqueCharacterId('!!!', [])).toBe('character')
    expect(castCharacterFrom(ok, ['pip'], 'coral')).toMatchObject({ id: 'pip-2', name: 'Pip', voice: 'coral', look: ok.look })
  })

  it('turns the wizard cast into the records a signup saves, with a voice only when the series speaks', () => {
    const cast = [castCharacterFrom(ok, [], 'coral')]
    const spoken = characterRecords(cast, { pip: { voice: 'onyx', instructions: 'soft' } }, true, 7)
    expect(spoken[0]).toMatchObject({ series: 7, name: 'Pip', bible: { look: ok.look, outfit: ok.outfit, personality: ok.personality }, canonicalDescription: `${ok.look} ${ok.outfit}`, voiceProfile: { voice: 'onyx', instructions: 'soft' } })
    expect(characterRecords(cast, { pip: { voice: 'onyx' } }, false, 7)[0].voiceProfile).toBeUndefined()
    expect(characterRecords(cast, {}, true, 7)[0].voiceProfile).toBeUndefined()
  })
})

describe('vetting a character before it is saved', () => {
  const ctx = (over: Partial<VetContext> = {}): VetContext => ({ operation: 'create', siblings: async () => [], moderate: async () => ({ flagged: false, reasons: [] }), ...over })
  const data = (over: Record<string, unknown> = {}) => ({ series: 1, name: ok.name, role: ok.role, bible: { look: ok.look, outfit: ok.outfit, personality: ok.personality }, canonicalDescription: `${ok.look} ${ok.outfit}`, voiceProfile: { voice: 'coral', instructions: 'soft' }, ...over })

  it('cleans the text in place and lets a good character through', async () => {
    const d = data({ name: '  Pip<b> ', bible: { look: 'a small\u0000 otter <i>with</i> a scarf', outfit: '', personality: '' } })
    await vetCharacter(d, ctx())
    expect(d.name).toBe('Pip b')
    expect((d.bible as { look: string }).look).toBe('a small otter i with /i a scarf')
  })

  it('stops a name or look that is missing or names a brand, with a message for the person', async () => {
    await expect(vetCharacter(data({ name: '' }), ctx())).rejects.toThrow(/Give the character a name/)
    await expect(vetCharacter(data({ bible: { look: 'tiny', outfit: '', personality: '' } }), ctx())).rejects.toThrow(/Describe what the character looks like/)
    await expect(vetCharacter(data({ name: 'Spiderman' }), ctx())).rejects.toThrow(/studio, brand or existing character/)
    await expect(vetCharacter(data({ voiceProfile: { voice: 'not-a-voice' } }), ctx())).rejects.toThrow(/available voices/)
  })

  it('allows at most three main characters in a series, and no two with the same name', async () => {
    const three = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }]
    const e = await vetCharacter(data(), ctx({ siblings: async () => three })).catch((x) => x)
    expect(e).toBeInstanceOf(CharacterError); expect(e.status).toBe(409); expect(e.message).toMatch(/at most 3/)
    const same = await vetCharacter(data({ name: 'pip' }), ctx({ siblings: async () => [{ id: 1, name: 'Pip' }] })).catch((x) => x)
    expect(same.status).toBe(409); expect(same.message).toMatch(/already a character called "pip"/)
    await expect(vetCharacter(data({ name: 'Rex' }), ctx({ siblings: async () => [{ id: 1, name: 'Pip' }, { id: 2, name: 'Luna' }] }))).resolves.toBeUndefined()
  })

  it('on an update, judges the whole character from what is stored plus the change, and does not count the character itself', async () => {
    const original = { id: 5, series: 1, name: 'Pip', role: '', bible: { look: ok.look, outfit: '', personality: 'shy' } }
    const mates = async () => [{ id: 5, name: 'Pip' }, { id: 6, name: 'Luna' }, { id: 7, name: 'Rex' }]
    const keep = { bible: { look: 'a small round otter with a blue scarf' } }
    await expect(vetCharacter(keep, ctx({ operation: 'update', original, siblings: mates }))).resolves.toBeUndefined() // three in the series, but this is one of them
    await expect(vetCharacter({ name: 'Luna' }, ctx({ operation: 'update', original, siblings: mates }))).rejects.toThrow(/already a character called "Luna"/)
    await expect(vetCharacter({ bible: { look: 'a pikachu' } }, ctx({ operation: 'update', original, siblings: mates }))).rejects.toThrow(/names a studio/)
    const untouched = { locked: true }
    await expect(vetCharacter(untouched, ctx({ operation: 'update', original, siblings: mates }))).resolves.toBeUndefined() // an update that changes no text is not judged
  })

  it('stops a description the free content check flags, and asks the check about everything that was written', async () => {
    const moderate = vi.fn(async (_t: string[]) => ({ flagged: true, reasons: ['violence'] }))
    const e = await vetCharacter(data(), ctx({ moderate })).catch((x) => x)
    expect(e.status).toBe(422); expect(e.message).toMatch(/flagged by the content check/)
    expect(moderate.mock.calls[0][0]).toEqual(expect.arrayContaining(['Pip', ok.role, ok.look, ok.outfit, ok.personality, 'soft']))
  })

  it('shows a refusal in the collection hook as a public message, and lets any other error through', async () => {
    const payload = { find: async () => ({ docs: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }] }) }
    const e = await vetCharacterHook({ data: data(), req: { payload: payload as never }, operation: 'create' }).catch((x) => x)
    expect(e.status).toBe(409); expect(e.message).toMatch(/at most 3/); expect(e.isPublic).toBe(true)
    await expect(vetCharacterHook({ data: data(), req: { payload: { find: async () => { throw new Error('db down') } } as never }, operation: 'create' })).rejects.toThrow('db down')
    await expect(vetCharacterHook({ data: data(), req: { payload: payload as never }, operation: 'delete' })).resolves.toBeUndefined()
  })
})

// ---------- the real database: the Characters collection runs the vetting itself ----------
describe('adding and removing characters in a real series', () => {
  let payload: Payload
  let user: User, other: User
  let seriesId: number
  const made = { users: [] as (string | number)[], series: [] as (string | number)[], media: [] as (string | number)[] }
  const key = process.env.OPENAI_API_KEY
  const input = (name: string, over: Record<string, unknown> = {}) => ({ name, role: 'the friend', look: `${name} is a small round otter with a red scarf`, outfit: 'a red scarf', personality: 'shy and brave', voice: 'coral', voiceInstructions: '', ...over })

  beforeAll(async () => {
    delete process.env.OPENAI_API_KEY // the content check is a call to OpenAI: not made here
    payload = await getPayload({ config: await config })
    const stamp = Date.now()
    user = (await payload.create({ collection: 'users', data: { username: `chars-${stamp}`, password: 'test-password-1234' } as never })) as User
    other = (await payload.create({ collection: 'users', data: { username: `chars-other-${stamp}`, password: 'test-password-1234' } as never })) as User
    made.users.push(user.id, other.id)
    const series = await payload.create({ collection: 'series', overrideAccess: true, data: { owner: user.id, title: 'Test series', niche: 'Cats', style: 'pixar-3d', voiceMode: 'character_voices', aspect: '9:16', status: 'active' } as never })
    seriesId = series.id; made.series.push(series.id)
  }, 60_000)

  afterAll(async () => {
    if (key) process.env.OPENAI_API_KEY = key
    if (!payload) return
    for (const id of made.media) await payload.delete({ collection: 'media', id, overrideAccess: true }).catch(() => undefined)
    for (const id of made.series) {
      await payload.delete({ collection: 'characters', where: { series: { equals: id } }, overrideAccess: true }).catch(() => undefined)
      await payload.delete({ collection: 'series', id, overrideAccess: true }).catch(() => undefined)
    }
    for (const id of made.users) await payload.delete({ collection: 'users', id, overrideAccess: true }).catch(() => undefined)
  }, 60_000)

  it('adds a character with its look, outfit, personality and voice, owned by the user and described for prompts', async () => {
    const r = await addCharacter(payload, user, seriesId, input('Pip'))
    const doc = await payload.findByID({ collection: 'characters', id: r.id, overrideAccess: true })
    expect(doc).toMatchObject({ name: 'Pip', role: 'the friend', locked: false })
    expect(doc.bible).toEqual({ look: 'Pip is a small round otter with a red scarf', outfit: 'a red scarf', personality: 'shy and brave' })
    expect(doc.canonicalDescription).toBe('Pip is a small round otter with a red scarf a red scarf')
    expect(doc.voiceProfile?.voice).toBe('coral')
    expect(typeof doc.owner === 'object' ? doc.owner.id : doc.owner).toBe(user.id)
  })

  it('refuses a duplicate name, a famous character, an invalid voice and a series that is not yours', async () => {
    await expect(addCharacter(payload, user, seriesId, input('pip'))).rejects.toMatchObject({ status: 409 })
    await expect(addCharacter(payload, user, seriesId, input('Rex', { look: 'a batman with a cape' }))).rejects.toMatchObject({ status: 400 })
    await expect(addCharacter(payload, user, seriesId, input('Rex', { voice: 'robot' }))).rejects.toBeInstanceOf(CharacterError)
    await expect(addCharacter(payload, other, seriesId, input('Rex'))).rejects.toMatchObject({ status: 404 })
    await expect(addCharacter(payload, user, 999999999, input('Rex'))).rejects.toMatchObject({ status: 404 })
    expect((await payload.find({ collection: 'characters', where: { series: { equals: seriesId } }, overrideAccess: true })).totalDocs).toBe(1)
  })

  it('allows three main characters and refuses a fourth, even when sent straight to the database', async () => {
    await addCharacter(payload, user, seriesId, input('Rex'))
    await addCharacter(payload, user, seriesId, input('Luna'))
    await expect(addCharacter(payload, user, seriesId, input('Coco'))).rejects.toMatchObject({ status: 409 })
    await expect(payload.create({ collection: 'characters', overrideAccess: true, data: { series: seriesId, owner: user.id, name: 'Zed', bible: { look: 'a tall green frog with boots', outfit: '', personality: '' } } as never })).rejects.toThrow(/at most 3/)
  })

  it('cleans the text of a character created or renamed directly, and refuses a rename to a name in use', async () => {
    const { docs } = await payload.find({ collection: 'characters', where: { series: { equals: seriesId }, name: { equals: 'Luna' } }, overrideAccess: true })
    const updated = await payload.update({ collection: 'characters', id: docs[0].id, overrideAccess: true, data: { bible: { look: 'a grey cat <b>with</b> green eyes', outfit: '', personality: '' } } as never })
    expect((updated.bible as { look: string }).look).toBe('a grey cat b with /b green eyes')
    await expect(payload.update({ collection: 'characters', id: docs[0].id, overrideAccess: true, data: { name: 'Rex' } })).rejects.toThrow(/already a character called "Rex"/)
    await expect(payload.update({ collection: 'characters', id: docs[0].id, overrideAccess: true, data: { locked: true } })).resolves.toBeTruthy() // no text changed: not judged
  })

  it('removes a character with its pack and images, keeps at least one, and only for its owner', async () => {
    const { docs } = await payload.find({ collection: 'characters', where: { series: { equals: seriesId }, name: { equals: 'Rex' } }, overrideAccess: true })
    const rex = docs[0]
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
    const sheet = await payload.create({ collection: 'media', overrideAccess: true, data: { alt: 'sheet' }, file: { data: png, mimetype: 'image/png', name: `rm-sheet-${Date.now()}.png`, size: png.length } })
    const face = await payload.create({ collection: 'media', overrideAccess: true, data: { alt: 'face' }, file: { data: png, mimetype: 'image/png', name: `rm-face-${Date.now()}.png`, size: png.length } })
    made.media.push(sheet.id, face.id)
    await payload.update({ collection: 'characters', id: rex.id, overrideAccess: true, data: { referenceImages: [sheet.id] } })
    await payload.create({ collection: 'asset-packs', overrideAccess: true, data: { owner: user.id, character: rex.id, items: [{ kind: 'expression', name: 'happy', image: face.id }] } as never })

    await expect(removeCharacter(payload, other, rex.id)).rejects.toMatchObject({ status: 404 })
    expect(await removeCharacter(payload, user, rex.id)).toEqual({ removed: true, name: 'Rex' })
    expect((await payload.find({ collection: 'characters', where: { id: { equals: rex.id } }, overrideAccess: true })).totalDocs).toBe(0)
    expect((await payload.find({ collection: 'asset-packs', where: { character: { equals: rex.id } }, overrideAccess: true })).totalDocs).toBe(0)
    for (const id of [sheet.id, face.id]) expect((await payload.find({ collection: 'media', where: { id: { equals: id } }, overrideAccess: true })).totalDocs).toBe(0)

    const rest = (await payload.find({ collection: 'characters', where: { series: { equals: seriesId } }, overrideAccess: true })).docs
    expect(rest).toHaveLength(2)
    await removeCharacter(payload, user, rest[0].id)
    await expect(removeCharacter(payload, user, rest[1].id)).rejects.toMatchObject({ status: 409 })
  })
})

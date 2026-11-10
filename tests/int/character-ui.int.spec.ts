import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement as h } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => nav, usePathname: () => '/start/characters' }))
vi.mock('next/link', async () => {
  const { createElement } = await import('react')
  return { default: ({ children, href }: { children: React.ReactNode; href: string }) => createElement('a', { href }, children) }
})

import { CastOptions } from '@/components/wizard/cast-options'
import { AuthForm } from '@/components/wizard/auth-form'
import { CastPanel } from '@/components/dashboard/cast-panel'
import { useCastFetch } from '@/lib/wizard/cast-fetch'
import { useWizard } from '@/lib/wizard/store'
import type { CastCharacter, CastOption } from '@/lib/art/cast-options'

const person = (name: string, over: Partial<CastCharacter> = {}): CastCharacter => ({ id: name.toLowerCase(), name, role: 'the friend', look: `${name} is a small round creature with soft fur`, outfit: 'a scarf', personality: 'shy and brave', voice: 'coral', ...over })
const option = (id: string, concept: string, names: string[]): CastOption => ({ id, concept, relationship: 'friends', image: null, characters: names.map((n) => person(n)) })
const A = option('opt-1', 'A bold duo', ['Mango', 'Luna'])
const B = option('opt-2', 'A lone explorer', ['Rex'])

/** A fetch that answers by address; every call is recorded. */
function stubFetch(routes: Record<string, (body: any) => { status?: number; body: unknown }>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const calls: { url: string; body: any }[] = [] // eslint-disable-line @typescript-eslint/no-explicit-any
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : undefined
    calls.push({ url, body })
    const key = Object.keys(routes).find((k) => url.startsWith(k))
    const r = key ? routes[key](body) : { status: 404, body: {} }
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body }
  }))
  return calls
}
const pass = { '/api/cast/check': () => ({ body: { problems: [] } }) }

beforeEach(() => {
  useWizard.getState().reset()
  useWizard.setState({ niche: 'Cat videos', style: 'pixar-3d' })
  useCastFetch.setState({ key: 'k', status: 'ready', options: [A, B], source: 'ai', error: '', regenerating: false })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); nav.refresh.mockClear(); nav.push.mockClear() })

const cast = () => useWizard.getState().cast
const radio = (name: RegExp) => screen.getByRole('radio', { name })
const fill = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

describe('the wizard: the Characters step', () => {
  it('starts with no characters and invites you to create your own or pick a cast', () => {
    stubFetch(pass)
    render(h(CastOptions))
    expect(screen.getByText(/Pick one of the casts above, or create your own character/)).toBeTruthy()
    expect(screen.getByText('0 of 3')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Create your own character/ })).toBeTruthy()
  })

  it('picking a cast gives you its characters to change, and keeps their ids and voices', () => {
    stubFetch(pass)
    render(h(CastOptions))
    fireEvent.click(radio(/A bold duo/))
    expect(cast().map((c) => c.name)).toEqual(['Mango', 'Luna'])
    expect(useWizard.getState().castOption?.id).toBe('opt-1')
    expect(screen.getByText('2 of 3')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edit Mango' })).toBeTruthy()
    expect(radio(/A bold duo/).getAttribute('aria-checked')).toBe('true')
  })

  it('changes a character: the form starts from what it has, and the change is saved after the check', async () => {
    const calls = stubFetch(pass)
    render(h(CastOptions))
    fireEvent.click(radio(/A bold duo/))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Mango' }))
    expect((screen.getByLabelText(/Name/) as HTMLInputElement).value).toBe('Mango')
    fill(/What do they look like/, 'Mango is a big orange tabby cat with a torn left ear')
    fireEvent.click(screen.getByRole('button', { name: 'Save character' }))
    await waitFor(() => expect(cast()[0].look).toBe('Mango is a big orange tabby cat with a torn left ear'))
    expect(cast()[0]).toMatchObject({ id: 'mango', name: 'Mango', voice: 'coral' }) // same character: same id and voice
    expect(calls.find((c) => c.url === '/api/cast/check')!.body.characters).toHaveLength(2)
    expect(screen.queryByRole('form', { name: 'Character details' })).toBeNull() // the form closed
  })

  it('adds a character you wrote: it needs a name and a look, is checked, gets its own voice, and the cast is capped at three', async () => {
    const calls = stubFetch(pass)
    render(h(CastOptions))
    fireEvent.click(radio(/A bold duo/))
    fireEvent.click(screen.getByRole('button', { name: /Add a character/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Add character' })) // nothing typed yet
    expect((await screen.findByRole('alert')).textContent).toMatch(/Give the character a name/)
    expect(calls).toHaveLength(0)
    fill(/Name/, 'Pip'); fill(/What do they look like/, 'a small round otter with brown fur and a red scarf')
    fireEvent.click(screen.getByRole('button', { name: 'Add character' }))
    await waitFor(() => expect(cast().map((c) => c.name)).toEqual(['Mango', 'Luna', 'Pip']))
    expect(cast()[2]).toMatchObject({ id: 'pip', look: 'a small round otter with brown fur and a red scarf' })
    expect(typeof cast()[2].voice).toBe('string')
    expect(calls[0].body.characters.map((c: { name: string }) => c.name)).toEqual(['Mango', 'Luna', 'Pip'])
    const add = screen.getByRole('button', { name: /Add a character/ }) as HTMLButtonElement
    expect(add.disabled).toBe(true) // three of three
    expect(screen.getByText('3 of 3')).toBeTruthy()
  })

  it('writes a whole cast of your own without picking an AI one', async () => {
    stubFetch(pass)
    render(h(CastOptions))
    fireEvent.click(screen.getByRole('button', { name: /Create your own character/ }))
    fill(/Name/, 'Aelira'); fill(/What do they look like/, 'a tall elf with silver hair and a green cloak')
    fireEvent.click(screen.getByRole('button', { name: 'Add character' }))
    await waitFor(() => expect(cast()).toHaveLength(1))
    expect(useWizard.getState().castOption).toBeNull()
    expect(cast()[0].name).toBe('Aelira')
  })

  it('does not add a name that is already in the cast, and does not ask the server first', async () => {
    const calls = stubFetch(pass)
    render(h(CastOptions))
    fireEvent.click(radio(/A bold duo/))
    fireEvent.click(screen.getByRole('button', { name: /Add a character/ }))
    fill(/Name/, 'mango'); fill(/What do they look like/, 'another cat with white socks and a bell')
    fireEvent.click(screen.getByRole('button', { name: 'Add character' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/same name/)
    expect(cast()).toHaveLength(2)
    expect(calls).toHaveLength(0)
  })

  it('shows what the check refuses (a brand, or the content check) and does not add the character', async () => {
    stubFetch({ '/api/cast/check': () => ({ body: { problems: ['That description was flagged by the content check, so it cannot be used. Try describing the character differently.'] } }) })
    render(h(CastOptions))
    fireEvent.click(screen.getByRole('button', { name: /Create your own character/ }))
    fill(/Name/, 'Zed'); fill(/What do they look like/, 'a green frog with tiny boots')
    fireEvent.click(screen.getByRole('button', { name: 'Add character' }))
    expect((await screen.findByText(/flagged by the content check/)).textContent).toBeTruthy()
    expect(cast()).toHaveLength(0)
    // a brand is stopped before anything is sent
    fill(/Name/, 'Mickey Mouse')
    fireEvent.click(screen.getByRole('button', { name: 'Add character' }))
    expect((await screen.findAllByText(/studio, brand or existing character/)).length).toBeGreaterThan(0)
  })

  it('still adds the character when the check cannot be made: the server checks it again when the series is created', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    render(h(CastOptions))
    fireEvent.click(screen.getByRole('button', { name: /Create your own character/ }))
    fill(/Name/, 'Zed'); fill(/What do they look like/, 'a green frog with tiny boots')
    fireEvent.click(screen.getByRole('button', { name: 'Add character' }))
    await waitFor(() => expect(cast()).toHaveLength(1))
  })

  it('removes a character and its voice, and cancels a form without changing anything', () => {
    stubFetch(pass)
    render(h(CastOptions))
    fireEvent.click(radio(/A bold duo/))
    useWizard.setState({ voices: { mango: { voice: 'onyx', instructions: '' }, luna: { voice: 'coral', instructions: '' } } })
    fireEvent.click(screen.getByRole('button', { name: 'Edit Luna' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(cast()).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Mango' }))
    expect(cast().map((c) => c.name)).toEqual(['Luna'])
    expect(Object.keys(useWizard.getState().voices)).toEqual(['luna'])
  })

  it('asks before another cast replaces characters you changed or wrote, and keeps them when you say so', async () => {
    stubFetch(pass)
    render(h(CastOptions))
    fireEvent.click(radio(/A bold duo/))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Luna' })) // now different from the cast
    fireEvent.click(radio(/A lone explorer/))
    const banner = screen.getByRole('alert')
    expect(within(banner).getByText(/characters you changed or wrote will be replaced/)).toBeTruthy()
    expect(cast().map((c) => c.name)).toEqual(['Mango']) // nothing replaced yet
    fireEvent.click(within(banner).getByRole('button', { name: 'Keep my characters' }))
    expect(cast().map((c) => c.name)).toEqual(['Mango'])
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(radio(/A lone explorer/))
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Use this cast' }))
    expect(cast().map((c) => c.name)).toEqual(['Rex'])
    expect(useWizard.getState().castOption?.id).toBe('opt-2')
  })

  it('a cast you have not changed is replaced at once, with no question', () => {
    stubFetch(pass)
    render(h(CastOptions))
    fireEvent.click(radio(/A bold duo/))
    fireEvent.click(radio(/A lone explorer/))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(cast().map((c) => c.name)).toEqual(['Rex'])
  })

  it('keeps your characters when the casts to choose from are made again', () => {
    stubFetch({ ...pass, '/api/cast-options': () => ({ body: { options: [], source: 'ai', costUsd: 0 } }) })
    render(h(CastOptions))
    fireEvent.click(radio(/A bold duo/))
    fireEvent.click(screen.getByRole('button', { name: /Regenerate options/ }))
    expect(cast().map((c) => c.name)).toEqual(['Mango', 'Luna'])
    expect(useWizard.getState().castOption).toBeNull() // only the highlight of the old cast goes
  })

  it('moves a saved wizard from before the editable cast: its characters become the cast', () => {
    const migrate = useWizard.persist.getOptions().migrate!
    const old = { niche: 'Cat videos', style: 'pixar-3d', castOption: A, voices: { mango: { voice: 'onyx', instructions: '' } } }
    const moved = migrate(old, 2) as unknown as { cast: CastCharacter[]; castOption: CastOption; voices: object }
    expect(moved.cast.map((c) => c.name)).toEqual(['Mango', 'Luna'])
    expect(moved.castOption.id).toBe('opt-1')
    expect(Object.keys(moved.voices)).toEqual(['mango'])
    expect((migrate({ niche: 'Cats' }, 1) as unknown as { cast: unknown[] }).cast).toEqual([]) // older ones start again
  })
})

describe('signup creates the characters of the cast', () => {
  it('saves every character, with its look, outfit, personality and chosen voice, after the series', async () => {
    const calls = stubFetch({
      '/api/users/login': () => ({ body: {} }),
      '/api/users': () => ({ body: { doc: { id: 1 } } }),
      '/api/series': () => ({ body: { doc: { id: 9 } } }),
      '/api/characters': () => ({ body: { doc: { id: 1 } } }),
    })
    useWizard.setState({
      subNicheName: 'cat drama', voiceMode: 'character_voices', cast: [person('Mango'), person('Pip', { outfit: '' })],
      voices: { mango: { voice: 'onyx', instructions: 'smug' }, pip: { voice: 'nova', instructions: '' } },
    })
    render(h(AuthForm, { mode: 'signup' }))
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'tester' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-long-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }))
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/dashboard/9?start=1'))
    const made = calls.filter((c) => c.url === '/api/characters').map((c) => c.body)
    expect(made).toHaveLength(2)
    expect(made[0]).toMatchObject({ series: 9, name: 'Mango', role: 'the friend', bible: { look: person('Mango').look, outfit: 'a scarf', personality: 'shy and brave' }, voiceProfile: { voice: 'onyx', instructions: 'smug' } })
    expect(made[1]).toMatchObject({ name: 'Pip', canonicalDescription: person('Pip').look, voiceProfile: { voice: 'nova' } })
    expect(calls.find((c) => c.url === '/api/series')!.body.format).toBe('30')
  })

  it('shows what the server refused for a character, and does not move on', async () => {
    stubFetch({
      '/api/users/login': () => ({ body: {} }), '/api/users': () => ({ body: { doc: { id: 1 } } }), '/api/series': () => ({ body: { doc: { id: 9 } } }),
      '/api/characters': () => ({ status: 422, body: { errors: [{ message: 'That description was flagged by the content check, so it cannot be used.' }] } }),
    })
    useWizard.setState({ voiceMode: 'none', cast: [person('Mango')] })
    render(h(AuthForm, { mode: 'signup' }))
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'tester' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-long-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }))
    expect((await screen.findByText(/flagged by the content check/)).textContent).toBeTruthy()
    expect(nav.push).not.toHaveBeenCalled()
  })
})

describe('signup says why it failed', () => {
  const taken = { errors: [{ name: 'ValidationError', data: { collection: 'users', errors: [{ message: 'A user with the given username is already registered.', path: 'username' }] }, message: 'The following field is invalid: username' }] }
  const submit = () => {
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'me@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-long-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }))
  }

  it('says the username is taken, and offers to log in instead, instead of "field is invalid: username"', async () => {
    stubFetch({ '/api/users': () => ({ status: 400, body: taken }) })
    render(h(AuthForm, { mode: 'signup' }))
    submit()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/That username is already taken. If it is yours, log in instead/)
    expect(alert.textContent).not.toMatch(/field is invalid/)
    expect(within(alert).getByRole('link', { name: 'Log in' }).getAttribute('href')).toBe('/login')
    expect(nav.push).not.toHaveBeenCalled()
  })

  it('keeps the wizard answers, so logging in afterwards still creates the series', async () => {
    stubFetch({ '/api/users': () => ({ status: 400, body: taken }) })
    useWizard.setState({ voiceMode: 'none', cast: [person('Mango')] })
    render(h(AuthForm, { mode: 'signup' }))
    submit()
    await screen.findByRole('alert')
    expect(cast()).toHaveLength(1)
  })

  it('shows any other reason as the server gave it', async () => {
    stubFetch({ '/api/users': () => ({ status: 400, body: { errors: [{ message: 'The password is too weak.' }] } }) })
    render(h(AuthForm, { mode: 'signup' }))
    submit()
    expect((await screen.findByRole('alert')).textContent).toBe('The password is too weak.')
  })
})

describe('the dashboard: add and remove a character', () => {
  const locked = { '/api/character-art': () => ({ body: { hasReference: true, locked: true, packVersion: 1, provider: 'fal', quality: 'fal.ai FLUX.2', costPerImage: 0.03, remainingUsd: 0, rebuildUsd: 0.1, spentUsd: 0, capUsd: 30, items: [] } }) }
  const row = (name: string) => ({ id: name.length * 10, name, role: 'friend', referenceUrl: null, canonical: `${name} look`, look: `${name} look`, personality: 'brave' })

  it('offers to add a character with a voice, sends it, and refreshes so its card appears', async () => {
    const calls = stubFetch({ ...locked, '/api/cast/characters': () => ({ body: { id: 5, name: 'Pip' } }) })
    render(h(CastPanel, { cast: [row('Mango')], seriesId: 3, speaks: true }))
    fireEvent.click(screen.getByRole('button', { name: /Add a character/ }))
    expect(screen.getByText('How this character sounds in every video')).toBeTruthy()
    fill(/Name/, 'Pip'); fill(/What do they look like/, 'a small round otter with brown fur and a red scarf'); fill(/Personality/, 'shy')
    fireEvent.click(screen.getByRole('button', { name: 'Add character' }))
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled())
    const sent = calls.find((c) => c.url === '/api/cast/characters')!.body
    expect(sent).toMatchObject({ action: 'add', seriesId: 3, character: { name: 'Pip', look: 'a small round otter with brown fur and a red scarf', personality: 'shy', voice: expect.any(String) } })
  })

  it('does not ask for a voice when the series has no character voices', () => {
    stubFetch(locked)
    render(h(CastPanel, { cast: [row('Mango')], seriesId: 3, speaks: false }))
    fireEvent.click(screen.getByRole('button', { name: /Add a character/ }))
    expect(screen.queryByText('How this character sounds in every video')).toBeNull()
  })

  it('shows what the server refused, and keeps the form open', async () => {
    stubFetch({ ...locked, '/api/cast/characters': () => ({ status: 409, body: { error: 'A series has at most 3 main characters.' } }) })
    render(h(CastPanel, { cast: [row('Mango')], seriesId: 3 }))
    fireEvent.click(screen.getByRole('button', { name: /Add a character/ }))
    fill(/Name/, 'Pip'); fill(/What do they look like/, 'a small round otter with brown fur and a red scarf')
    fireEvent.click(screen.getByRole('button', { name: 'Add character' }))
    expect((await screen.findByText(/at most 3 main characters/)).textContent).toBeTruthy()
    expect(nav.refresh).not.toHaveBeenCalled()
    expect(screen.getByRole('form', { name: 'Character details' })).toBeTruthy()
  })

  it('has no add button at three characters, and says why', () => {
    stubFetch(locked)
    render(h(CastPanel, { cast: [row('Mango'), row('Luna'), row('Rex')], seriesId: 3 }))
    expect(screen.queryByRole('button', { name: /Add a character/ })).toBeNull()
    expect(screen.getByText(/at most 3 main characters. Remove one to add another/)).toBeTruthy()
  })

  it('removes a character only after asking, only when there is more than one, and refreshes', async () => {
    const calls = stubFetch({ ...locked, '/api/cast/characters': () => ({ body: { removed: true, name: 'Luna' } }) })
    const { unmount } = render(h(CastPanel, { cast: [row('Mango')], seriesId: 3 }))
    await screen.findByText(/Locked/)
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull() // the only character stays
    unmount()
    render(h(CastPanel, { cast: [row('Mango'), row('Luna')], seriesId: 3 }))
    const removes = await screen.findAllByRole('button', { name: 'Remove' })
    fireEvent.click(removes[1])
    expect(screen.getByText(/Remove Luna and its images\? Videos you already made keep their look/)).toBeTruthy()
    expect(calls.find((c) => c.url === '/api/cast/characters')).toBeUndefined() // nothing sent yet
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled())
    expect(calls.find((c) => c.url === '/api/cast/characters')!.body).toEqual({ action: 'remove', characterId: 40 })
  })

  it('can be cancelled without removing anything', async () => {
    const calls = stubFetch({ ...locked, '/api/cast/characters': () => ({ body: {} }) })
    render(h(CastPanel, { cast: [row('Mango'), row('Luna')], seriesId: 3 }))
    const removes = await screen.findAllByRole('button', { name: 'Remove' })
    fireEvent.click(removes[0])
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(calls.find((c) => c.url === '/api/cast/characters')).toBeUndefined()
  })
})

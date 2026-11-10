import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement as h } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const nav = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => nav, usePathname: () => '/dashboard/28' }))
vi.mock('@/lib/local-folder/use-local-folder', () => ({
  useLocalFolder: () => ({ status: 'connected', error: null, syncing: false, folderPath: '/videos', choose: vi.fn(), reconnect: vi.fn(), forget: vi.fn(), localUrls: {} }),
}))

import { LibraryGrid, type EpisodeCard } from '@/components/dashboard/library-grid'
import { ProgressCard } from '@/components/dashboard/progress-card'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); nav.refresh.mockClear() })

const daily = { used: 1, limit: 3, left: 2, nextAt: null }
const failedCard = (over: Partial<EpisodeCard> = {}): EpisodeCard => ({
  id: 37, title: 'Zipline Shortcut Chaos', status: 'failed', hook: 'Pip launches off with goggles askew.', hasVideo: false,
  failure: { reason: 'keyframe 37-shot-1-1 failed: Connection error.', label: 'Retry from Art Director' }, ...over,
})
const grid = (episodes: EpisodeCard[], running: number | null = null) =>
  render(h(LibraryGrid, { seriesId: 28, title: 'Pip and Mox', daily, episodes, runningEpisodeId: running, autoStart: false }))

/** A fetch that answers by address; each answer is a status and a body. */
function stubFetch(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: { url: string; method: string }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string }) => {
    calls.push({ url, method: init?.method ?? 'GET' })
    const key = Object.keys(routes).find((k) => url.startsWith(k))
    const r = key ? routes[key] : { status: 404, body: {} }
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body }
  }))
  return calls
}

const running = { episode: { id: 37, status: 'running', title: 'Zipline Shortcut Chaos', error: null, costUsd: 0.17, mode: 'text' }, steps: [{ key: 'art-director', agent: 'Art Director', label: 'Planning the shots', status: 'running', summary: '' }] }

describe('retry button on a failed video', () => {
  it('shows why it failed and a button that names the step it will pick up from', () => {
    stubFetch({})
    grid([failedCard()])
    expect(screen.getByText(/Connection error/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Retry from Art Director/ })).toBeTruthy()
  })

  it('shows no retry button on a finished or running video', () => {
    stubFetch({})
    grid([{ id: 1, title: 'Done one', status: 'done', hook: null, hasVideo: true }, { id: 2, title: 'Busy', status: 'running', hook: null, hasVideo: false }], 2)
    expect(screen.queryByRole('button', { name: /Retry|Try again/ })).toBeNull()
  })

  it('asks the server to retry that exact video, then follows it live', async () => {
    const calls = stubFetch({ '/api/episodes/37/retry': { body: { episodeId: 37, plan: 'script' } }, '/api/pipeline/progress': { body: running } })
    grid([failedCard()])
    fireEvent.click(screen.getByRole('button', { name: /Retry from Art Director/ }))
    await waitFor(() => expect(screen.getByText('Making your episode…')).toBeTruthy())
    expect(calls.find((c) => c.url === '/api/episodes/37/retry')).toMatchObject({ method: 'POST' })
    expect(nav.refresh).toHaveBeenCalled()
    // the live card now follows it, so the card in the list does not show a second button for the same video
    expect(screen.queryByRole('button', { name: /Retry from Art Director/ })).toBeNull()
  })

  it('says why when the server refuses (for example the daily limit) and lets the user try again later', async () => {
    stubFetch({ '/api/episodes/37/retry': { status: 423, body: { error: 'You can make 3 videos a day. The next one is available in 2 h.' } } })
    grid([failedCard()])
    fireEvent.click(screen.getByRole('button', { name: /Retry from Art Director/ }))
    await waitFor(() => expect(screen.getByText(/3 videos a day/)).toBeTruthy())
    expect((screen.getByRole('button', { name: /Retry from Art Director/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('is disabled while another video is being made', () => {
    stubFetch({ '/api/pipeline/progress': { body: { ...running, episode: { ...running.episode, id: 99 } } } })
    grid([failedCard(), { id: 99, title: 'In progress', status: 'running', hook: null, hasVideo: false }], 99)
    expect((screen.getByRole('button', { name: /Retry from Art Director/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('says "Try again" when the video stopped before any step started', () => {
    stubFetch({})
    grid([failedCard({ failure: { reason: 'Mox has no finished reference pack yet. Generate all of its images first.', label: 'Try again' } })])
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(screen.getByText(/no finished reference pack/)).toBeTruthy()
  })
})

describe('retry button on the live progress card', () => {
  it('appears when the run fails, names the failed step, and calls onRetry', async () => {
    stubFetch({ '/api/pipeline/progress': { body: { episode: { ...running.episode, status: 'failed', error: 'keyframe failed: Connection error.' }, steps: [{ ...running.steps[0], status: 'failed', summary: 'Connection error.' }] } } })
    const onRetry = vi.fn()
    render(h(ProgressCard, { episodeId: 37, onFinished: vi.fn(), onDismiss: vi.fn(), onRetry }))
    const button = await screen.findByRole('button', { name: /Retry from Art Director/ })
    fireEvent.click(button)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('is not there while the run is still going, or when no retry is offered', async () => {
    stubFetch({ '/api/pipeline/progress': { body: running } })
    render(h(ProgressCard, { episodeId: 37, onFinished: vi.fn(), onDismiss: vi.fn(), onRetry: vi.fn() }))
    await screen.findByText('Making your episode…')
    expect(screen.queryByRole('button', { name: /Retry|Try again/ })).toBeNull()
  })
})

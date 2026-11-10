'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useWizard } from '@/lib/wizard/store'
import { characterRecords } from '@/lib/characters'
import { authErrorMessage, USERNAME_TAKEN } from '@/lib/auth-errors'

async function api(path: string, body: unknown) {
  const res = await fetch(`/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'include' })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(authErrorMessage(json))
  return json
}

export function AuthForm({ mode }: { mode: 'signup' | 'login' }) {
  const router = useRouter()
  const w = useWizard()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const hasWizard = Boolean(w.niche && w.style && w.cast.length > 0)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(''); setBusy(true)
    const f = new FormData(e.currentTarget)
    const username = String(f.get('username')).trim()
    const password = String(f.get('password'))
    try {
      if (mode === 'signup') await api('users', { username, password })
      await api('users/login', { username, password })
      if (hasWizard) {
        // the readable sub-niche name comes from the research result kept in the wizard (AI sub-niche ids are not in any mock list)
        const sub = w.subNicheName || undefined
        const speaking = w.voiceMode === 'character_voices' || w.voiceMode === 'narrator_and_characters'
        const { doc } = await api('series', {
          title: sub || w.niche, niche: w.niche, subNiche: sub, style: w.style, format: '30',
          styleBible: w.styleBible ?? undefined, styleApplicability: w.styleApplicability ?? undefined, voiceApplicability: w.voiceApplicability ?? undefined,
          voiceMode: w.voiceMode || 'none', narratorVoice: w.narrator ?? undefined, aspect: w.aspect, status: 'active',
        })
        // the characters are checked again here by the server (originality, at most three, own names, content check)
        for (const record of characterRecords(w.cast, w.voices, speaking, doc.id)) await api('characters', record)
        w.reset()
        router.push(`/dashboard/${doc.id}?start=1`)
      } else {
        router.push('/dashboard') // sends users with no series to the wizard
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{mode === 'signup' ? 'Create your account' : 'Welcome back'}</CardTitle>
          {mode === 'signup' && hasWizard && <p className="text-sm text-muted-foreground">Your {w.niche} series is ready. Sign up to start the first video.</p>}
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2"><Label htmlFor="username">Username</Label><Input id="username" name="username" required autoComplete="username" /></div>
            <div className="space-y-2"><Label htmlFor="password">Password</Label><Input id="password" name="password" type="password" required minLength={8} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} /></div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}{error === USERNAME_TAKEN && <> <Link className="underline" href="/login">Log in</Link></>}
              </p>
            )}
            <Button disabled={busy} className="w-full bg-accent text-accent-foreground hover:bg-accent/90">{busy ? 'Please wait…' : mode === 'signup' ? 'Sign up' : 'Log in'}</Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            {mode === 'signup' ? <>Have an account? <Link className="text-foreground underline" href="/login">Log in</Link></> : <>New here? <Link className="text-foreground underline" href="/start">Start</Link></>}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

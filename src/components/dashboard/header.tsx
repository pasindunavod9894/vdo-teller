'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { LogOut, Plus } from 'lucide-react'
import { useWizard } from '@/lib/wizard/store'

export type SeriesLink = { id: number | string; title: string }

export function DashHeader({ series, currentId, username }: { series: SeriesLink[]; currentId: number | string; username: string }) {
  const router = useRouter()
  const reset = useWizard((s) => s.reset)

  async function logout() {
    await fetch('/api/users/logout', { method: 'POST', credentials: 'include' })
    router.push('/login'); router.refresh()
  }

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-6 py-3">
        <Link href="/dashboard" className="font-heading mr-auto text-lg font-semibold tracking-tight sm:mr-0">VDO Teller</Link>
        <nav className="order-last flex w-full min-w-0 items-center gap-1 overflow-x-auto sm:order-none sm:ml-2 sm:w-auto sm:flex-1" aria-label="Your series">
          {series.map((s) => (
            <Link key={s.id} href={`/dashboard/${s.id}`} aria-current={String(s.id) === String(currentId) ? 'page' : undefined}
              className={`whitespace-nowrap rounded-full px-3 py-1 text-sm ${String(s.id) === String(currentId) ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              {s.title}
            </Link>
          ))}
        </nav>
        <button onClick={() => { reset(); router.push('/start') }} className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm hover:border-accent">
          <Plus className="size-4" /> New series
        </button>
        <span className="hidden text-sm text-muted-foreground sm:inline">{username}</span>
        <button onClick={logout} aria-label="Log out" title="Log out" className="rounded-full p-2 text-muted-foreground hover:text-foreground"><LogOut className="size-4" /></button>
      </div>
    </header>
  )
}

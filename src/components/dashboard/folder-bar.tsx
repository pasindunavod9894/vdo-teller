'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FolderCheck, FolderOpen, FolderX, Loader2, RefreshCw } from 'lucide-react'
import type { FolderStatus } from '@/lib/local-folder/use-local-folder'

const UNDO_SECONDS = 10

/**
 * Shows where the series' videos are saved (plan §6): a banner until a folder is chosen, a "Reconnect" chip when the
 * browser needs permission again, and, if the folder was deleted, an undo toast before the series section is removed.
 */
export function FolderBar({ seriesId, status, error, syncing, folderPath, onChoose, onReconnect, onForget }: {
  seriesId: number | string; status: FolderStatus; error: string; syncing: boolean; folderPath: string
  onChoose: () => void; onReconnect: () => void; onForget: () => Promise<void>
}) {
  const router = useRouter()
  const [left, setLeft] = useState(UNDO_SECONDS)
  const cancelled = useRef(false)

  // folder deleted: count down, then remove the section (it can still be undone until then)
  useEffect(() => {
    if (status !== 'missing') return
    cancelled.current = false
    setLeft(UNDO_SECONDS)
    const t = setInterval(() => setLeft((n) => n - 1), 1000)
    return () => clearInterval(t)
  }, [status])
  useEffect(() => {
    if (status !== 'missing' || left > 0 || cancelled.current) return
    cancelled.current = true
    fetch(`/api/series/${seriesId}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'remove' }) })
      .then(() => { router.push('/dashboard'); router.refresh() })
  }, [left, status, seriesId, router])

  if (status === 'checking') return null

  if (status === 'unsupported') {
    return (
      <div role="alert" className="mb-4 flex items-start gap-3 rounded-[var(--radius)] border border-destructive/50 bg-destructive/10 p-4 text-sm">
        <FolderX className="mt-0.5 size-5 shrink-0" />
        <p>This browser cannot save videos to a folder on your computer. Open VDO Teller in <strong>Chrome or Edge</strong> to choose a folder. Generation starts once a folder is chosen.</p>
      </div>
    )
  }

  if (status === 'missing') {
    return (
      <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-destructive/50 bg-destructive/10 p-4 text-sm">
        <FolderX className="size-5 shrink-0" />
        <p className="flex-1">The folder <span className="font-mono">{folderPath}</span> was deleted. This series will be removed in {Math.max(0, left)}s.</p>
        <button onClick={() => { cancelled.current = true; onForget() }} className="rounded-full border border-border px-3 py-1 hover:border-accent">Undo</button>
      </div>
    )
  }

  if (status === 'no-folder') {
    return (
      <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-accent bg-card p-4 text-sm">
        <FolderOpen className="size-5 shrink-0" />
        <p className="flex-1">Choose a folder for this series. <strong>We will start generating once you give folder access</strong>; your videos are saved in <span className="font-mono">{folderPath}</span>.</p>
        <button onClick={onChoose} className="rounded-full bg-accent px-4 py-1.5 text-accent-foreground">Choose folder</button>
        {error && <p className="w-full text-xs text-destructive">{error}</p>}
      </div>
    )
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {status === 'needs-permission' ? (
        <button onClick={onReconnect} className="flex items-center gap-1.5 rounded-full border border-accent px-3 py-1 text-foreground hover:bg-accent hover:text-accent-foreground">
          <RefreshCw className="size-3.5" /> Reconnect folder
        </button>
      ) : (
        <span className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1">
          {syncing ? <Loader2 className="size-3.5 animate-spin" /> : <FolderCheck className="size-3.5" />} Saved to <span className="font-mono text-foreground">{folderPath}</span>
        </span>
      )}
      {error && <span className="text-destructive">{error}</span>}
    </div>
  )
}

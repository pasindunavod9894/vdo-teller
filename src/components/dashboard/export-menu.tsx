'use client'
import { useState } from 'react'
import { Download } from 'lucide-react'

const FORMATS = [
  ['9:16', 'Reels / Shorts / TikTok · 1080×1920'], ['16:9', 'YouTube · 1920×1080'], ['1:1', 'Square · 1080×1080'], ['4:5', 'Feed · 1080×1350'],
] as const

export function ExportMenu({ enabled, main }: { enabled: boolean; main: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm hover:border-accent">
        <Download className="size-4" /> Export
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-2 w-72 rounded-xl border border-border bg-card p-2 shadow-xl">
          {FORMATS.map(([ratio, label]) => (
            <button key={ratio} disabled={!enabled} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm enabled:hover:bg-muted disabled:opacity-50">
              <span><span className="font-medium">{ratio}</span> <span className="text-xs text-muted-foreground">{label}</span></span>
              {ratio === main && <span className="rounded-full bg-accent/20 px-2 text-[10px] text-accent">main</span>}
            </button>
          ))}
          {!enabled && <p className="px-3 pb-1 pt-2 text-xs text-muted-foreground">Exports unlock after your first video.</p>}
        </div>
      )}
    </div>
  )
}

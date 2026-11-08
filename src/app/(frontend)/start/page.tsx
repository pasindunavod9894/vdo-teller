'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { motion } from 'motion/react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useWizard } from '@/lib/wizard/store'

const EXAMPLES = ['Cat videos', 'Kids bedtime stories', 'Personal finance', 'Ancient history', 'Cooking']

export default function StartPage() {
  const router = useRouter()
  const { niche, set } = useWizard()
  const [value, setValue] = useState(niche)

  const go = (n: string) => {
    const v = n.trim()
    if (!v) return
    set({ niche: v, subNiche: '', style: '', voiceMode: '' })
    router.push('/start/sub-niche')
  }

  return (
    <div className="mx-auto max-w-2xl pt-10 text-center">
      <motion.h1 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="text-4xl font-semibold tracking-tight sm:text-5xl">
        What kind of videos do you want to make?
      </motion.h1>
      <p className="mt-4 text-muted-foreground">Type any topic. We research it and build a video series around it.</p>
      <form onSubmit={(e) => { e.preventDefault(); go(value) }} className="mt-8 flex gap-2">
        <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. Cat videos" className="h-12 text-base" />
        <Button type="submit" size="lg" disabled={!value.trim()} className="h-12 bg-accent text-accent-foreground hover:bg-accent/90">Start</Button>
      </form>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {EXAMPLES.map((e) => (
          <button key={e} onClick={() => go(e)} className="rounded-full border border-border px-3 py-1 text-sm text-muted-foreground hover:border-accent hover:text-foreground">{e}</button>
        ))}
      </div>
    </div>
  )
}

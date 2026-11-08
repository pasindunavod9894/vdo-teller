'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AnimatePresence, motion } from 'motion/react'
import { STEPS } from './steps'
import { cn } from '@/lib/utils'

export function StartShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const slug = pathname.split('/')[2]
  const index = STEPS.findIndex((s) => s.slug === slug)
  const progress = slug === undefined ? 0 : ((index + 1) / (STEPS.length + 1)) * 100

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute -top-40 left-1/2 size-[640px] -translate-x-1/2 rounded-full bg-accent/20 blur-3xl" />
      <header className="relative mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <Link href="/" className="font-semibold tracking-tight">VDO Teller</Link>
        <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground">Log in</Link>
      </header>
      <div className="relative mx-auto max-w-5xl px-6">
        <div className="h-1 overflow-hidden rounded-full bg-muted">
          <motion.div className="h-full bg-accent" animate={{ width: `${progress}%` }} transition={{ type: 'spring', stiffness: 120, damping: 20 }} />
        </div>
        <ol className="mt-3 hidden gap-2 text-xs sm:flex">
          {STEPS.map((s, i) => (
            <li key={s.slug} className={cn('rounded-full px-2.5 py-1', i === index ? 'bg-accent/20 text-accent' : i < index ? 'text-foreground' : 'text-muted-foreground')}>
              {i + 1}. {s.label}
            </li>
          ))}
        </ol>
      </div>
      <AnimatePresence mode="wait">
        <motion.main
          key={pathname}
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
          className="relative mx-auto max-w-5xl px-6 pb-24 pt-10"
        >
          {children}
        </motion.main>
      </AnimatePresence>
    </div>
  )
}

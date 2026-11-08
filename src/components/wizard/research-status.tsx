'use client'
import { motion } from 'motion/react'

const LINES = ['Checking what is trending…', 'Comparing styles for your niche…', 'Estimating monetization potential…']

export function Researching() {
  return (
    <div className="grid place-items-center py-20 text-center">
      <motion.div
        className="size-10 rounded-full border-2 border-accent border-t-transparent"
        animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.9, ease: 'linear' }}
      />
      <p className="mt-5 font-medium">The Showrunner is researching your niche</p>
      <div className="mt-2 h-5 overflow-hidden text-sm text-muted-foreground">
        <motion.div animate={{ y: ['0%', '-100%', '-200%', '0%'] }} transition={{ repeat: Infinity, duration: 6, times: [0, 0.33, 0.66, 1] }}>
          {LINES.map((l) => <div key={l} className="h-5">{l}</div>)}
        </motion.div>
      </div>
    </div>
  )
}

export function SourceBadge({ source }: { source: 'ai' | 'mock' | null }) {
  if (!source) return null
  return (
    <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
      {source === 'ai' ? 'AI research' : 'Sample data'}
    </span>
  )
}

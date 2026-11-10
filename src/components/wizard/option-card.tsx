'use client'
import { motion } from 'motion/react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export function OptionCard({
  selected, onClick, title, subtitle, badge, badgeTone = 'accent', children, dim, media, radio, tabIndex, onKeyDown,
}: {
  selected?: boolean; onClick: () => void; title: string; subtitle?: string
  badge?: string; badgeTone?: 'accent' | 'muted'; children?: React.ReactNode; dim?: boolean
  /** a picture shown at the top of the card, edge to edge */
  media?: React.ReactNode
  /** the card is one choice of a radio group (the parent provides role="radiogroup" and the arrow keys) */
  radio?: boolean; tabIndex?: number; onKeyDown?: React.KeyboardEventHandler<HTMLButtonElement>
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      onKeyDown={onKeyDown}
      tabIndex={tabIndex}
      {...(radio ? { role: 'radio', 'aria-checked': Boolean(selected) } : { 'aria-pressed': selected === undefined ? undefined : selected })}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.98 }}
      className={cn(
        'relative w-full overflow-hidden rounded-xl border bg-card p-5 text-left transition-colors',
        selected ? 'border-accent ring-2 ring-accent/40' : 'border-border hover:border-muted-foreground/40',
        dim && 'opacity-60',
      )}
    >
      {media && <div className="-mx-5 -mt-5 mb-4">{media}</div>}
      {selected && (
        <motion.span
          initial={{ scale: 0 }} animate={{ scale: 1 }}
          className="absolute right-3 top-3 grid size-6 place-items-center rounded-full bg-accent text-accent-foreground"
        >
          <Check className="size-4" />
        </motion.span>
      )}
      {badge && (
        <span className={cn('mb-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium',
          badgeTone === 'accent' ? 'bg-accent/20 text-accent' : 'bg-muted text-muted-foreground')}>
          {badge}
        </span>
      )}
      <div className="pr-8 text-lg font-semibold">{title}</div>
      {subtitle && <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>}
      {children && <div className="mt-3 text-sm">{children}</div>}
    </motion.button>
  )
}

'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { STEPS } from './steps'

export function StepFooter({ slug, canContinue }: { slug: string; canContinue: boolean }) {
  const router = useRouter()
  const i = STEPS.findIndex((s) => s.slug === slug)
  const prev = i <= 0 ? '/start' : `/start/${STEPS[i - 1].slug}`
  const next = i === STEPS.length - 1 ? '/signup' : `/start/${STEPS[i + 1].slug}`
  return (
    <div className="mt-10 flex items-center justify-between">
      <Button variant="ghost" asChild><Link href={prev}>Back</Link></Button>
      <Button disabled={!canContinue} onClick={() => router.push(next)} className="bg-accent text-accent-foreground hover:bg-accent/90">
        {i === STEPS.length - 1 ? 'Create my series' : 'Continue'}
      </Button>
    </div>
  )
}

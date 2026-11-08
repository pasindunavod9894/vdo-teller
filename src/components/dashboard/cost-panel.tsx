import { summarizeCosts, type StepCost } from '@/lib/cost-summary'

const usd = (n: number) => `$${n.toFixed(n < 0.1 ? 3 : 2)}`

/** Where the money of the latest episode went, step by step, so a cost problem is visible instead of a surprise. */
export function CostPanel({ title, steps, ceilingUsd }: { title: string; steps: StepCost[]; ceilingUsd: number }) {
  const s = summarizeCosts(steps)
  if (!s.rows.length) return <p className="text-sm text-muted-foreground">Costs appear here after the first episode ({usd(ceilingUsd)} is the most one episode may cost).</p>
  return (
    <div className="rounded-[var(--radius)] border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm"><span className="font-medium">{title}</span> <span className="text-muted-foreground">cost {usd(s.totalUsd)} of a {usd(ceilingUsd)} ceiling</span></div>
        <div className="text-xs text-muted-foreground">Prompt cache hit {Math.round(s.cacheHit * 100)}%{s.biggest ? ` · biggest: ${s.biggest.agent} (${Math.round(s.biggest.share * 100)}%)` : ''}</div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-muted-foreground"><tr><th className="py-1 pr-3 font-normal">Step</th><th className="pr-3 font-normal">Model</th><th className="pr-3 font-normal">Tokens in / cached / out</th><th className="pr-3 font-normal">Images</th><th className="pr-3 font-normal">Video</th><th className="text-right font-normal">Cost</th></tr></thead>
          <tbody>
            {s.rows.map((r, i) => (
              <tr key={i} className="border-t border-border">
                <td className="py-1 pr-3">{r.agent}</td><td className="pr-3 text-muted-foreground">{r.model || '-'}</td>
                <td className="pr-3 font-mono">{r.inTokens ? `${r.inTokens} / ${r.cached} / ${r.outTokens}` : '-'}</td>
                <td className="pr-3">{r.images || '-'}</td><td className="pr-3">{r.videoSec ? `${r.videoSec}s` : '-'}</td>
                <td className="text-right font-mono">{usd(r.usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

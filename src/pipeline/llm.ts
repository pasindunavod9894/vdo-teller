import { Agent, run, webSearchTool } from '@openai/agents'
import type { z } from 'zod'
import { flexEnabled, maxOutputTokens, MODELS, REASONING, tokenCostUsd, type AgentModelKey } from '@/agents/models'
import { buildPrompt } from '@/agents/prompt-builder'
import type { AgentName } from '@/agents/profile'
import type { Ctx, LlmCall, LlmReply, LlmRunner, Usage } from './ctx'

/** The real model call: one Agents SDK agent per request, with the cache-friendly prompt and the output cap of its agent. */
export const sdkRunner: LlmRunner = async (call: LlmCall): Promise<LlmReply> => {
  // The SDK's generics don't accept a generic zod schema here; the schema is validated by the SDK at runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agent = new Agent<unknown, any>({
    name: call.agent, model: call.model, instructions: call.prompt.system, outputType: call.schema,
    ...(call.webSearch ? { tools: [webSearchTool({ searchContextSize: 'low' })] } : {}),
    modelSettings: {
      reasoning: { effort: REASONING[call.modelKey] }, text: { verbosity: 'low' }, ...(maxOutputTokens(call.modelKey) ? { maxTokens: maxOutputTokens(call.modelKey) } : {}),
      providerData: { prompt_cache_key: call.prompt.cacheKey, ...(call.flex ? { service_tier: 'flex' } : {}) },
    },
  })
  const res = await run(agent, call.prompt.user)
  if (res.finalOutput == null) throw new Error(`${call.agent} returned no structured output`)
  const u = res.state.usage
  const sum = (v: unknown, key: string) => (v as Record<string, number>[] | undefined)?.reduce((s, d) => s + (d?.[key] ?? 0), 0) ?? 0
  return {
    output: res.finalOutput,
    usage: { inputTokens: u.inputTokens, cachedTokens: sum(u.inputTokensDetails, 'cached_tokens'), outputTokens: u.outputTokens, reasoningTokens: sum(u.outputTokensDetails, 'reasoning_tokens') },
  }
}

/**
 * Runs one language-model agent: builds the prompt (rules, series profile, role, episode data), calls the runner, and prices the answer.
 * Flex pricing is used only for scheduled runs when switched on; if flex is briefly unavailable the same call is made once at the normal price.
 */
export async function runTextAgent<S extends z.ZodType>(
  agent: AgentName, modelKey: AgentModelKey, schema: S, ctx: Ctx, episode: Record<string, unknown> | string, opts: { webSearch?: boolean } = {},
): Promise<{ output: z.infer<S>; usage: Usage }> {
  const prompt = buildPrompt(agent, ctx.profile, episode, ctx.seriesId)
  const model = MODELS[modelKey]
  const runner = ctx.llm ?? sdkRunner
  let flex = flexEnabled() && ctx.scheduled === true
  let reply: LlmReply
  try {
    reply = await runner({ agent, modelKey, model, schema, prompt, flex, webSearch: opts.webSearch })
  } catch (e) {
    const status = (e as { status?: number }).status
    if (!flex || !(status === 429 || /resource.*unavailable|flex/i.test((e as Error).message))) throw e
    flex = false
    reply = await runner({ agent, modelKey, model, schema, prompt, flex, webSearch: opts.webSearch })
  }
  const parsed = schema.safeParse(reply.output)
  if (!parsed.success) throw new Error(`${agent} returned an answer that does not match its format: ${parsed.error.issues[0]?.message ?? 'invalid'}`)
  const usage: Usage = { model, ...reply.usage, costUsd: 0 }
  usage.costUsd = tokenCostUsd(model, usage, { flex })
  return { output: parsed.data as z.infer<S>, usage }
}

/** Adds several model usages into one (an agent step that makes more than one call reports a single usage). */
export function addUsage(parts: (Usage | undefined)[], model = 'multiple'): Usage | undefined {
  const real = parts.filter((p): p is Usage => !!p)
  if (!real.length) return undefined
  const sum = (k: 'inputTokens' | 'cachedTokens' | 'outputTokens' | 'reasoningTokens' | 'costUsd') => real.reduce((n, p) => n + p[k], 0)
  return {
    model: new Set(real.map((p) => p.model)).size === 1 ? real[0].model : model,
    inputTokens: sum('inputTokens'), cachedTokens: sum('cachedTokens'), outputTokens: sum('outputTokens'), reasoningTokens: sum('reasoningTokens'),
    costUsd: Math.round(sum('costUsd') * 1e6) / 1e6,
  }
}

import fs from 'node:fs'
import path from 'node:path'
import { probe } from '../../engine/ffmpeg'
import { DEFAULT_LIPSYNC_MODEL, LIPSYNC_MODELS, lipsyncCostUsd, type LipsyncModelId } from '../../lib/video'
import { classifyFalError, realClient, VideoError, type FalLike } from './fal'

/**
 * Lip-sync on fal.ai (plan R1-D.5): a dialogue clip and the line's speech go in, the same clip with a moving mouth comes out.
 * Checked afterwards by the continuity check, because a lip-sync model can change a face.
 */
export type LipsyncRequest = {
  model?: LipsyncModelId
  videoFile: string
  audioFile: string
  destFile: string
  client?: FalLike
  fetchImpl?: typeof fetch
}
export type LipsyncResult = { file: string; costUsd: number; model: LipsyncModelId; mock?: boolean }

const uploadFile = (client: FalLike, file: string, type: string) => client.storage.upload(new Blob([fs.readFileSync(file)], { type }))

export async function generateLipsync(req: LipsyncRequest): Promise<LipsyncResult> {
  const model = req.model ?? DEFAULT_LIPSYNC_MODEL
  const client = req.client ?? realClient()
  const doFetch = req.fetchImpl ?? fetch
  const seconds = (await probe(req.videoFile)).durationSec
  try {
    const [videoUrl, audioUrl] = await Promise.all([uploadFile(client, req.videoFile, 'video/mp4'), uploadFile(client, req.audioFile, req.audioFile.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg')])
    // `cut_off`: the result is as long as the shorter of the two, so a line never runs past its clip
    const res = await client.subscribe(LIPSYNC_MODELS[model].endpoint, { input: { video_url: videoUrl, audio_url: audioUrl, sync_mode: 'cut_off' } })
    const url = (res.data as { video?: { url?: unknown } } | undefined)?.video?.url
    if (typeof url !== 'string' || !url.startsWith('http')) throw new VideoError('fal.ai returned no lip-synced video', 'invalid')
    const r = await doFetch(url)
    if (!r.ok) throw new VideoError(`Could not download the lip-synced clip (HTTP ${r.status})`, 'download')
    fs.mkdirSync(path.dirname(req.destFile), { recursive: true })
    fs.writeFileSync(req.destFile, Buffer.from(await r.arrayBuffer()))
    if ((await probe(req.destFile)).durationSec < 0.5) throw new VideoError('The lip-synced clip is empty', 'download')
    return { file: req.destFile, costUsd: lipsyncCostUsd(model, seconds), model }
  } catch (e) {
    if (e instanceof VideoError) throw e
    throw new VideoError((e as Error)?.message || 'Lip-sync failed', classifyFalError(e))
  }
}

/** Free stand-in: the clip is returned unchanged. */
export async function generateMockLipsync(req: LipsyncRequest): Promise<LipsyncResult> {
  fs.mkdirSync(path.dirname(req.destFile), { recursive: true })
  fs.copyFileSync(req.videoFile, req.destFile)
  return { file: req.destFile, costUsd: 0, model: req.model ?? DEFAULT_LIPSYNC_MODEL, mock: true }
}

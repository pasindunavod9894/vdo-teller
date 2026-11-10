import { spawn } from 'node:child_process'

/**
 * The one place that starts FFmpeg and ffprobe (the video engine, audio finish, sound effects, mock media and the fal adapter
 * all use it). The binaries come from FFMPEG_PATH / FFPROBE_PATH, or from the PATH when those are not set.
 */
export const ffmpegBin = () => process.env.FFMPEG_PATH || 'ffmpeg'
export const ffprobeBin = () => process.env.FFPROBE_PATH || 'ffprobe'

export type Captured = { stdout: Buffer; stderr: string }

/** Runs a binary, collecting stdout as bytes and stderr as text. Rejects with the tail of stderr on a non-zero exit. */
function exec(bin: string, args: string[], label: string, cwd?: string): Promise<Captured> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { cwd })
    const out: Buffer[] = []
    let err = ''
    p.stdout.on('data', (c: Buffer) => out.push(c))
    p.stderr.on('data', (c) => { err += c })
    p.on('error', (e) => reject(new Error(`${label} could not start: ${e.message}`)))
    p.on('close', (code) => (code === 0 ? resolve({ stdout: Buffer.concat(out), stderr: err }) : reject(new Error(`${label} failed: ${err.slice(-400)}`))))
  })
}

/** Runs FFmpeg and returns its log (stderr), which is where filters such as ebur128 and loudnorm print their results. */
export async function run(args: string[], opts: { cwd?: string } = {}): Promise<string> {
  return (await exec(ffmpegBin(), args, 'ffmpeg', opts.cwd)).stderr
}

/** Runs FFmpeg with `-f ... -` style output and returns what it wrote to stdout (for example one JPEG frame). */
export function runCapture(args: string[]): Promise<Captured> {
  return exec(ffmpegBin(), args, 'ffmpeg')
}

export type Probe = { width: number; height: number; durationSec: number; /** length of the video stream alone (the file can have a longer audio track) */ videoSec: number; hasVideo: boolean; hasAudio: boolean; fps: number }

/** Reads the size, length, frame rate and streams of an image, video or audio file. */
export async function probe(file: string): Promise<Probe> {
  const { stdout } = await exec(ffprobeBin(), ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,avg_frame_rate,duration:format=duration', '-of', 'json', file], 'ffprobe')
  const j = JSON.parse(stdout.toString('utf8')) as { streams?: { codec_type: string; width?: number; height?: number; avg_frame_rate?: string; duration?: string }[]; format?: { duration?: string } }
  const streams = j.streams ?? []
  const v = streams.find((s) => s.codec_type === 'video')
  const [n, d] = (v?.avg_frame_rate ?? '0/1').split('/').map(Number)
  const dur = Number(j.format?.duration ?? v?.duration ?? streams.find((s) => s.codec_type === 'audio')?.duration ?? 0)
  const vdur = Number(v?.duration)
  return {
    width: v?.width ?? 0, height: v?.height ?? 0, durationSec: Number.isFinite(dur) ? dur : 0, videoSec: Number.isFinite(vdur) && vdur > 0 ? vdur : (Number.isFinite(dur) ? dur : 0),
    hasVideo: !!v, hasAudio: streams.some((s) => s.codec_type === 'audio'), fps: d ? n / d : 0,
  }
}

/** Width and height of an image (or the first frame of a video). */
export async function imageSize(file: string): Promise<{ width: number; height: number }> {
  const p = await probe(file)
  if (!p.width || !p.height) throw new Error(`Could not read the size of ${file}`)
  return { width: p.width, height: p.height }
}

/** Escapes a value for use inside an FFmpeg filter argument (file names in `ass=`, `subtitles=`, `drawtext=`). */
export const filterEscape = (v: string) => v.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/,/g, '\\,').replace(/\[/g, '\\[').replace(/\]/g, '\\]')

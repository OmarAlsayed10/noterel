import { randomUUID } from 'expo-crypto'
import { z } from 'zod'
import KestrelSourceProcessing from '../../modules/kestrel-source-processing'
import { facebookVideoMedia } from '../sources/facebookMedia'
import { facebookVideoPreview } from '../sources/facebook'
import { discardTemporaryAudio, type AudioCandidate } from './transcription'

const candidateSchema = z.object({ uri: z.string().startsWith('file://'), filename: z.string().max(200), size: z.number().int().positive().max(128 * 1024 * 1024), mediaType: z.enum(['audio/mp4', 'video/mp4']) }).strict()
const cancelled = () => new Error('Facebook video preparation cancelled')

export async function prepareFacebookVideo(url: string, signal?: AbortSignal): Promise<AudioCandidate> {
  if (signal?.aborted) throw cancelled()
  const requestId = randomUUID()
  const abort = () => KestrelSourceProcessing.cancelFacebookVideoMedia(requestId)
  signal?.addEventListener('abort', abort, { once: true })
  try {
    const page = await KestrelSourceProcessing.fetchFacebookVideo(url)
    if (signal?.aborted) throw cancelled()
    const media = facebookVideoMedia(page.html, url, page.finalUrl)
    const candidate = candidateSchema.parse(await KestrelSourceProcessing.prepareFacebookVideoMedia(media, requestId))
    if (signal?.aborted) { discardTemporaryAudio(candidate); throw cancelled() }
    return { ...candidate, origin: { url, ...facebookVideoPreview(page.html) } }
  } finally {
    signal?.removeEventListener('abort', abort)
    KestrelSourceProcessing.releaseFacebookVideoMedia(requestId)
  }
}

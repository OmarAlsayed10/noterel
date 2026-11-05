import { normalizeIncomingShare } from '../capture/incomingShare'
import { failedCaptureSnapshot, persistTranscriptCapture, type SavedTranscriptCapture } from '../capture/transcriptCaptures'
import { t } from '../i18n'
import { transcriptionOriginSchema, videoSourceSchema, type TranscriptionOrigin } from './source'
import type { AudioTranscriptionJob } from './transcription'

export async function sourceForTranscription(captureId: string | undefined, url: string): Promise<TranscriptionOrigin> {
  const source = videoSourceSchema.parse({ url })
  return captureId ? await failedCaptureSnapshot(captureId, url) ?? source : source
}

export async function saveReviewedTranscript(job: AudioTranscriptionJob, input: { readonly title: string; readonly text: string }): Promise<SavedTranscriptCapture> {
  if (job.state !== 'succeeded' || !job.text?.trim() || !input.text.trim()) throw new RangeError('Transcription is not ready to save')
  const origin = job.origin ? transcriptionOriginSchema.parse(job.origin) : undefined
  const source = origin ? videoSourceSchema.parse({ url: origin.url, title: origin.title, thumbnailUrl: origin.thumbnailUrl }) : undefined
  const sourceUrl = source?.url.replace(/\(/gu, '%28').replace(/\)/gu, '%29')
  const text = sourceUrl ? `[${t('library.source')}](${sourceUrl})\n\n${input.text.trim()}` : input.text
  const payload = normalizeIncomingShare({ title: input.title, text, transcription: { jobId: job.id, ...(source ? { source } : {}) } })
  return persistTranscriptCapture(payload, origin)
}

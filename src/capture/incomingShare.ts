import { tiktokUrl } from '../sources/tiktok'
import { savedTranscriptionSchema, type SavedTranscription } from '../transcription/source'

export interface IncomingShare {
  readonly kind: 'note' | 'url'
  readonly text: string
  readonly title: string | null
  readonly captionLanguage?: string
  readonly captureMode?: 'reference' | 'extract'
  readonly takeaway?: string
  readonly transcription?: SavedTranscription
}

const maximumSharedTextBytes = 1024 * 1024

export const referenceCapture = (capture: IncomingShare): boolean => capture.kind === 'url' && capture.captureMode === 'reference'

const supportedUrl = (value: string): string | null => {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password ? url.toString() : null
  } catch {
    return null
  }
}

export function normalizeIncomingShare(input: { text?: string | null; webUrl?: string | null; title?: string | null; files?: readonly unknown[]; captionLanguage?: string; captureMode?: 'reference' | 'extract'; takeaway?: string; transcription?: SavedTranscription }): IncomingShare {
  if (input.files?.length) throw new RangeError('Only shared text and links are supported')
  const text = input.text?.trim() ?? ''
  const webUrl = input.webUrl ? supportedUrl(input.webUrl.trim()) : null
  const exactUrl = supportedUrl(text)
  const normalizedText = webUrl ?? text
  if (!normalizedText) throw new RangeError('Shared text is empty')
  if (new TextEncoder().encode(normalizedText).byteLength > maximumSharedTextBytes) throw new RangeError('Shared text exceeds the 1 MiB limit')
  const title = input.title?.trim() || null
  if (title && new TextEncoder().encode(title).byteLength > 512) throw new RangeError('Shared title exceeds the 512-byte limit')
  if (input.captionLanguage && (!tiktokUrl(normalizedText) || !/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/u.test(input.captionLanguage))) throw new RangeError('TikTok caption language is invalid')
  if (input.captureMode && input.captureMode !== 'reference' && input.captureMode !== 'extract') throw new RangeError('Capture mode is invalid')
  if (input.takeaway && new TextEncoder().encode(input.takeaway).byteLength > 8192) throw new RangeError('Takeaway exceeds the 8 KiB limit')
  const kind = exactUrl || webUrl ? 'url' : 'note'
  if (input.transcription && kind !== 'note') throw new RangeError('Transcription must be saved as a note')
  const transcription = input.transcription ? savedTranscriptionSchema.parse(input.transcription) : undefined
  return { kind, text: normalizedText, title, ...(input.captionLanguage ? { captionLanguage: input.captionLanguage } : {}), ...(kind === 'url' ? { captureMode: input.captureMode ?? (input.captionLanguage ? 'extract' : 'reference') } : {}), ...(kind === 'url' && input.takeaway !== undefined ? { takeaway: input.takeaway } : {}), ...(transcription ? { transcription } : {}) }
}

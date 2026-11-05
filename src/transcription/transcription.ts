import { File, Paths } from 'expo-file-system'
import { z } from 'zod'
import KestrelSourceProcessing from '../../modules/kestrel-source-processing'
import { currentLanguage, t } from '../i18n'
import { requestNotificationPermission } from '../notifications'
import { decodeTranscriptionOrigin, transcriptionOriginSchema, type TranscriptionOrigin } from './source'

const transcriptionJobSchema = z.object({
  id: z.string().uuid(),
  state: z.enum(['queued', 'transcribing', 'succeeded', 'failed', 'cancelled', 'missing']),
  progress: z.number().int().min(0).max(100),
  title: z.string().max(200).nullable().optional(),
  text: z.string().max(1024 * 1024).nullable().optional(),
  detectedLanguages: z.array(z.string().regex(/^[a-z]{2,3}$/u)).optional(),
  durationSeconds: z.number().positive().max(1800).nullable().optional(),
  error: z.string().nullable().optional(),
  originJson: z.string().nullable().optional(),
  originReadError: z.boolean().optional()
}).transform(({ originJson, originReadError, ...job }) => {
  const origin = originJson && originJson.length <= 8192 ? decodeTranscriptionOrigin(originJson) : null
  if (originReadError || originJson !== undefined && originJson !== null && !origin) return { ...job, origin: undefined, state: 'failed' as const, error: t('transcription.source_unavailable') }
  return { ...job, ...(origin ? { origin } : {}) }
})
const modelSchema = z.enum(['small', 'medium'])
const modelDownloadSchema = z.object({ state: z.enum(['idle', 'queued', 'downloading', 'succeeded', 'failed', 'cancelled']), downloadedBytes: z.number().nonnegative(), totalBytes: z.number().positive(), error: z.string().nullable().optional() })

export type TranscriptionModel = z.infer<typeof modelSchema>
export type TranscriptionModelDownload = z.infer<typeof modelDownloadSchema>
export type AudioTranscriptionJob = z.infer<typeof transcriptionJobSchema>
export type TranscriptionLanguage = 'auto' | 'ar' | 'en'

export interface AudioCandidate {
  readonly uri: string
  readonly filename: string
  readonly size: number
  readonly mediaType: string
  readonly origin?: TranscriptionOrigin
}

export const transcriptionModels: readonly { readonly id: TranscriptionModel; readonly name: string; readonly downloadSize: string; readonly detail: string }[] = [
  { id: 'small', name: 'Whisper Small', downloadSize: '376 MB', detail: 'Faster. Recommended for most voice messages.' },
  { id: 'medium', name: 'Whisper Medium', downloadSize: '946 MB', detail: 'More accurate, but slower and heavier on memory.' }
]

export async function installedTranscriptionModels(): Promise<readonly TranscriptionModel[]> {
  const models = await KestrelSourceProcessing.installedTranscriptionModels()
  return models.map(model => modelSchema.safeParse(model)).filter(result => result.success).map(result => result.data)
}

export async function downloadTranscriptionModel(model: TranscriptionModel): Promise<void> {
  await requestNotificationPermission()
  await KestrelSourceProcessing.downloadTranscriptionModel(model, currentLanguage())
}
export const transcriptionModelDownloadState = async (model: TranscriptionModel) => modelDownloadSchema.parse(await KestrelSourceProcessing.transcriptionModelDownloadState(model))
export const cancelTranscriptionModelDownload = (model: TranscriptionModel): Promise<void> => KestrelSourceProcessing.cancelTranscriptionModelDownload(model)
export const deleteTranscriptionModel = (model: TranscriptionModel): Promise<number> => KestrelSourceProcessing.deleteTranscriptionModel(model)

export async function startAudioTranscription(audio: AudioCandidate, model: TranscriptionModel, language: TranscriptionLanguage): Promise<string> {
  if (!Number.isFinite(audio.size) || audio.size <= 0 || audio.size > 128 * 1024 * 1024) throw new RangeError('Choose audio or video no larger than 128 MiB')
  const origin = audio.origin ? transcriptionOriginSchema.parse(audio.origin) : null
  await requestNotificationPermission()
  return KestrelSourceProcessing.enqueueAudioTranscription(audio.uri, audio.filename, { model, language, interfaceLanguage: currentLanguage(), ...(origin ? { originJson: JSON.stringify(origin) } : {}) })
}

export const audioTranscriptionJob = async (jobId: string): Promise<AudioTranscriptionJob> => transcriptionJobSchema.parse(await KestrelSourceProcessing.audioTranscriptionJob(jobId))
export const audioTranscriptionJobs = async (): Promise<readonly AudioTranscriptionJob[]> => z.array(transcriptionJobSchema).parse(await KestrelSourceProcessing.audioTranscriptionJobs())
export const deleteAudioTranscriptionJob = (jobId: string): Promise<void> => KestrelSourceProcessing.deleteAudioTranscriptionJob(jobId)

export function discardTemporaryAudio(audio: AudioCandidate): void {
  if (!audio.uri.startsWith(Paths.cache.uri)) return
  const file = new File(audio.uri)
  if (file.exists) file.delete()
}

import * as Crypto from 'expo-crypto'
import { File } from 'expo-file-system'
import { z } from 'zod'
import { t } from '../../i18n'
import { transcriptionOriginSchema } from '../source'
import type { AudioCandidate, AudioTranscriptionJob, TranscriptionLanguage } from '../transcription'
import { authenticatedCloudAccess } from './account'
import { cloudJobSchema, type StoredCloudJob } from './protocol'
import { deleteCloudAudio, keepCloudAudio, removeStoredCloudJob, storeCloudJob, storedCloudJobs } from './storage'
import { cloudErrorText, cloudRequest, uploadCloudFile } from './transport'

const uploading = new Set<string>()
export const cloudJobUploading = (id: string): boolean => uploading.has(id)
const terminal = (job: StoredCloudJob): boolean => job.job.state === 'succeeded' || job.job.state === 'failed'
const filenameForUpload = (filename: string): string => {
  let bytes = 0
  let bounded = ''
  for (const character of filename) {
    bytes += new TextEncoder().encode(character).length
    if (bytes > 512) break
    bounded += character
  }
  return bounded || 'recording'
}

async function ownedCloudJob(access: Awaited<ReturnType<typeof authenticatedCloudAccess>>, id: string): Promise<StoredCloudJob> {
  const job = (await storedCloudJobs(access.endpoint, access.accountId)).find(candidate => candidate.id === id)
  if (!job) throw new Error(t('cloud.job_missing'))
  return job
}

export async function startCloudTranscription(audio: AudioCandidate, language: TranscriptionLanguage): Promise<string> {
  const access = await authenticatedCloudAccess()
  if (!Number.isFinite(audio.size) || audio.size <= 0 || audio.size > 128 * 1024 * 1024) throw new RangeError('Choose audio or video no larger than 128 MiB')
  const existing = await storedCloudJobs(access.endpoint, access.accountId)
  if (existing.some(job => !terminal(job))) throw new Error(t('cloud.active_job'))
  const id = Crypto.randomUUID()
  const origin = audio.origin ? transcriptionOriginSchema.parse(audio.origin) : undefined
  const audioUri = await keepCloudAudio(audio, id)
  try {
    const filename = filenameForUpload(audio.filename)
    await storeCloudJob({ id, endpoint: access.endpoint, accountId: access.accountId, filename, language, origin, audioUri, uploadPending: true, createdAt: Date.now(), job: { id, state: 'queued', progress: 0, uploadAccepted: false, title: filename } })
  } catch (error) {
    deleteCloudAudio(audioUri)
    throw error
  }
  return id
}

async function receiveCloudJob(stored: StoredCloudJob, response: unknown): Promise<StoredCloudJob> {
  const job = cloudJobSchema.parse(response)
  if (job.id !== stored.id) throw new Error(t('cloud.request_failed'))
  const accepted = job.uploadAccepted
  const received = { ...stored, job, uploadPending: stored.uploadPending && !accepted, uploadError: null }
  await storeCloudJob(received)
  if (accepted && received.audioUri) {
    deleteCloudAudio(received.audioUri)
    const cleaned = { ...received, audioUri: null }
    await storeCloudJob(cleaned)
    return cleaned
  }
  return received
}

export async function retryCloudUpload(id: string): Promise<void> {
  if (uploading.has(id)) return
  uploading.add(id)
  try {
    const access = await authenticatedCloudAccess()
    const stored = await ownedCloudJob(access, id)
    if (!stored.uploadPending || !stored.audioUri) return
    const file = new File(stored.audioUri)
    if (!file.exists) throw new Error(t('cloud.audio_missing'))
    let response
    try {
      response = await uploadCloudFile(access.token, stored)
    } catch (error) {
      await storeCloudJob({ ...stored, uploadError: error instanceof Error ? error.message.slice(0, 2048) : t('cloud.request_failed') })
      throw error
    }
    await receiveCloudJob(stored, response)
  } finally {
    uploading.delete(id)
  }
}

export async function refreshCloudJobs(): Promise<readonly StoredCloudJob[]> {
  const access = await authenticatedCloudAccess()
  const remote = z.object({ jobs: z.array(cloudJobSchema) }).parse(await cloudRequest(access.endpoint, '/jobs', { token: access.token }))
  const local = await storedCloudJobs(access.endpoint, access.accountId)
  for (const stored of local) {
    const job = remote.jobs.find(candidate => candidate.id === stored.id)
    if (job && !uploading.has(stored.id)) await receiveCloudJob(stored, job)
  }
  for (const job of remote.jobs) {
    if (local.some(stored => stored.id === job.id)) continue
    await storeCloudJob({ id: job.id, endpoint: access.endpoint, accountId: access.accountId, filename: job.title ?? t('transcription.transcript_title'), language: 'auto', audioUri: null, uploadPending: false, createdAt: Date.now(), job })
  }
  return storedCloudJobs(access.endpoint, access.accountId)
}

export async function cloudTranscriptionJob(id: string): Promise<AudioTranscriptionJob> {
  const stored = await ownedCloudJob(await authenticatedCloudAccess(), id)
  if (stored.uploadPending) throw new Error(t('cloud.upload_pending'))
  return { ...stored.job, error: stored.job.errorCode ? cloudErrorText(stored.job.errorCode) : stored.job.error, origin: stored.origin }
}

export async function deleteCloudTranscriptionJob(id: string): Promise<void> {
  if (uploading.has(id)) throw new Error(t('cloud.uploading'))
  const access = await authenticatedCloudAccess()
  const stored = await ownedCloudJob(access, id)
  if (!terminal(stored) && !stored.uploadPending) throw new Error(t('cloud.cannot_remove_active'))
  try {
    await cloudRequest(access.endpoint, `/jobs/${id}`, { token: access.token, method: 'DELETE' })
  } catch (error) {
    if (!terminal(stored) || !(error instanceof Error) || !('status' in error) || error.status !== 404) throw error
  }
  await removeStoredCloudJob(stored)
}
